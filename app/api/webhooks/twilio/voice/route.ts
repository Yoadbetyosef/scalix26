import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runAIPipeline, DEFAULT_TONE } from '@/lib/anthropic/pipeline'
import { intakeLead } from '@/lib/leads/speed-to-lead'
import { stripMarkdown } from '@/lib/utils'

// Ring the owner's phone below the carrier-voicemail pickup window (~20-25s) so the
// AI takes over before voicemail grabs the call. Belt to the AMD suspenders below.
const FORWARD_DIAL_TIMEOUT = 15

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function gatherUrl(baseUrl: string, conversationId?: string) {
  const url = `${baseUrl}/api/webhooks/twilio/voice`
  return conversationId ? `${url}?cid=${encodeURIComponent(conversationId)}` : url
}

// Speak via Deepgram Aura TTS (served by /api/tts) when configured; fall back
// to Twilio Polly when no Deepgram key is set, so voice never breaks.
function ttsPlay(text: string): string {
  const clean = stripMarkdown(text)
  if (process.env.DEEPGRAM_API_KEY) {
    return `<Play>${process.env.NEXT_PUBLIC_APP_URL}/api/tts?text=${encodeURIComponent(clean)}</Play>`
  }
  return `<Say voice="Polly.Joanna-Neural">${escapeXml(clean)}</Say>`
}

// Per-agent voice language → STT language (consumed by the Railway voice-server:
// 'multi' selects nova-3 multilingual EN<->ES code-switch), the Aura TTS voice, and
// a system-prompt language directive. 'en' is the default so existing agents are
// untouched. Note: a single Aura voice speaks one language's phonetics, so for
// 'bilingual' (Spanish-leaning tenants) we use a Spanish voice; nova-3 still
// understands both, and the model replies in the caller's language.
const SPANISH_AURA_VOICE = 'aura-2-celeste-es'
function voiceLangConfig(lang: string | null | undefined, agentVoice: string | null | undefined) {
  const v = (agentVoice || '')
  const isAura = v.toLowerCase().startsWith('aura')
  const isAuraEs = /-es$/i.test(v)
  if (lang === 'es') {
    return { stt: 'es', voiceId: isAuraEs ? v : SPANISH_AURA_VOICE, promptLine: 'IMPORTANT: The caller speaks Spanish — always respond in Spanish (Español).' }
  }
  if (lang === 'bilingual') {
    return { stt: 'multi', voiceId: isAuraEs ? v : SPANISH_AURA_VOICE, promptLine: "IMPORTANT: Respond in the caller's language — Spanish if they speak Spanish, English if they speak English. Match their language on every turn." }
  }
  // 'en' (default) — unchanged English behavior.
  return { stt: 'en-US', voiceId: isAura ? v : '', promptLine: 'Always respond in English.' }
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))
  const { From, To } = params
  const isGatherCallback = 'SpeechResult' in params
  const SpeechResult = params.SpeechResult || ''

  const conversationId = req.nextUrl.searchParams.get('cid') || undefined

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
  const supabase = await createServiceClient()

  const toNormalized = To?.startsWith('+') ? To : `+${To}`
  const { data: channels } = await supabase
    .from('channels')
    .select('tenant_id, ai_employee_id')
    .eq('twilio_number', toNormalized)
    .limit(1)
  const channel = channels?.[0] ?? null

  // Safety net: the AI normally answers every call, but if Twilio reports the
  // call went unanswered (e.g. forwarded to the owner who didn't pick up),
  // fire Speed to Lead so the caller still gets an instant text back.
  const callStatus = params.CallStatus
  if (channel && From && (callStatus === 'no-answer' || callStatus === 'busy' || callStatus === 'failed')) {
    try {
      await intakeLead({ tenantId: channel.tenant_id, phone: From, source: 'missed_call' })
    } catch (err) {
      console.error('[voice] missed-call speed-to-lead failed:', err instanceof Error ? err.message : err)
    }
    return new NextResponse('<?xml version="1.0"?><Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  // Gather callback — user spoke
  if (isGatherCallback) {
    if (!SpeechResult) {
      const action = gatherUrl(baseUrl, conversationId)
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US" timeout="8">
    ${ttsPlay("Sorry, I didn't catch that. Go ahead.")}
  </Gather>
  ${ttsPlay("I couldn't hear you. Please call us back. Goodbye!")}
</Response>`
      return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
    }

    if (channel) {
      try {
        const pipelineStart = Date.now()
        console.log(`[voice][latency] runAIPipeline START @ ${new Date(pipelineStart).toISOString()} | speech="${SpeechResult.slice(0, 60)}"`)
        const result = await runAIPipeline({
          tenantId: channel.tenant_id,
          agentId: channel.ai_employee_id ?? undefined,
          channelType: 'voice',
          from: From,
          messageContent: SpeechResult,
          conversationId,
        })
        const pipelineMs = Date.now() - pipelineStart
        console.log(`[voice][latency] runAIPipeline END | took ${pipelineMs}ms (Claude) | response.len=${result.response?.length ?? 0}`)

        const action = gatherUrl(baseUrl, result.conversationId)

        // Human has taken over this conversation — don't let the AI speak.
        if (result.skipped) {
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US" timeout="8">
    ${ttsPlay("One moment please, let me connect you with someone from our team.")}
  </Gather>
</Response>`
          return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
        }

        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US" timeout="8">
    ${ttsPlay(result.response)}
  </Gather>
  ${ttsPlay("Feel free to call back anytime. Goodbye!")}
</Response>`
        return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
      } catch (err) {
        console.error('Voice pipeline error:', err instanceof Error ? err.message : err)
        const action = gatherUrl(baseUrl, conversationId)
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US" timeout="8">
    ${ttsPlay("Sorry about that, I had a hiccup. What can I help you with?")}
  </Gather>
</Response>`
        return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
      }
    }
  }

  // Fresh call — load agent config (forward_to_phone + greeting live on the agent)
  if (channel) {
    const agentQuery = channel.ai_employee_id
      ? supabase.from('ai_employees').select('id, forward_to_phone, greeting, status, system_prompt, name, business_name, voice, voice_language').eq('id', channel.ai_employee_id).single()
      : supabase.from('ai_employees').select('id, forward_to_phone, greeting, status, system_prompt, name, business_name, voice, voice_language').eq('tenant_id', channel.tenant_id).eq('status', 'active').maybeSingle()

    const { data: agent } = await agentQuery

    const forwardTo = agent?.forward_to_phone
    const greeting = agent?.greeting || 'Hello! Thank you for calling. How can I help you today?'

    if (forwardTo) {
      const fallbackAction = `${baseUrl}/api/webhooks/twilio/voice/ai-fallback`
      const amdCallback = `${baseUrl}/api/webhooks/twilio/voice/amd`
      // machineDetection on the dialed <Number> runs AMD on the owner's leg. If a
      // voicemail/machine answers, the amd callback redirects the caller to the AI.
      // answerOnBridge keeps the caller on ringback (not "answered") until a real
      // human bridge. action catches no-answer/busy/failed → AI.
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${FORWARD_DIAL_TIMEOUT}" action="${fallbackAction}" method="POST" answerOnBridge="true">
    <Number machineDetection="Enable" amdStatusCallback="${amdCallback}" amdStatusCallbackMethod="POST">${escapeXml(forwardTo)}</Number>
  </Dial>
</Response>`
      return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
    }

    // ── Realtime Media Streams (Railway voice-server) ──────────────────────
    // When VOICE_SERVER_WS_URL is configured, bridge the call to the WebSocket
    // server for streaming STT/LLM/TTS (sub-second latency). The agent's
    // system_prompt is passed through as a custom parameter.
    const wsUrl = process.env.VOICE_SERVER_WS_URL
    if (wsUrl && wsUrl.startsWith('wss://') && !wsUrl.includes('REPLACE')) {
      const baseVoicePrompt = agent?.system_prompt && agent.system_prompt.trim().length > 0
        ? agent.system_prompt
        : `You are ${agent?.name || 'Alex'}, a professional AI receptionist for ${agent?.business_name || 'our company'}. Your job is to answer calls, help customers, and collect their information. Keep every response under 2 sentences. Be warm, friendly, and fast.`
      // Prepend the default tone + a voice-formatting line + booking-tracking
      // rules. (Deepgram runs the whole conversation, so we can't inject a
      // per-turn summary like the SMS pipeline — the model tracks fields from
      // its own context, so the instruction must be explicit.)
      const bookingRules = `APPOINTMENT BOOKING: The details you need are service, date, time, name, phone, and address. As the customer gives each one, remember it. NEVER ask for a detail the customer already gave or that you already confirmed — re-read the conversation before asking. Ask for only ONE missing detail at a time. Once you have all six, confirm the full booking once (service, date, time, name, phone, address) and stop asking.`
      const langCfg = voiceLangConfig(agent?.voice_language, agent?.voice)
      let voiceSystemPrompt = `${DEFAULT_TONE}\n\n${langCfg.promptLine}\n\nSpeak naturally in full sentences. No lists, no markdown, no formatting symbols.\n\n${bookingRules}\n\n${baseVoicePrompt}`

      // If the business has configured appointment slots, let the AI actually
      // schedule via the check_availability / book_appointment functions.
      const { count: slotsCount } = await supabase
        .from('appointment_slots')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', channel.tenant_id)
        .eq('is_active', true)
      if (slotsCount && slotsCount > 0) {
        voiceSystemPrompt += `\n\nAPPOINTMENT SCHEDULING: You CAN schedule appointments. When a customer wants to book, use check_availability to find open slots for their preferred date, then use book_appointment to confirm. Always collect name, phone number, and service type before booking.`
      }

      // Knowledge base (pricing, service areas, etc.) scoped to this agent (plus
      // any tenant-wide entries) — not other agents'.
      let kbQuery = supabase.from('knowledge_base').select('title, content')
        .eq('tenant_id', channel.tenant_id).order('created_at', { ascending: true })
      if (agent?.id) kbQuery = kbQuery.or(`ai_employee_id.eq.${agent.id},ai_employee_id.is.null`)
      const { data: kbRows } = await kbQuery
      const kbContent = (kbRows || []).map((r) => `## ${r.title}\n${r.content}`).join('\n\n')
      if (kbContent) {
        voiceSystemPrompt += `\n\nKNOWLEDGE BASE:\n${kbContent}`
      }

      const sp = escapeXml(voiceSystemPrompt)
      // Owner phone for the lead-alert SMS. Try owner_phone (may not exist yet),
      // fall back to the business phone, then the call-forwarding number.
      let ownerPhone = ''
      let leadToken = ''
      const { data: tWith } = await supabase.from('tenants').select('owner_phone, phone, lead_intake_token').eq('id', channel.tenant_id).maybeSingle()
      if (tWith) {
        ownerPhone = tWith.owner_phone || tWith.phone || ''
        leadToken = tWith.lead_intake_token || ''
      } else {
        const { data: tBase } = await supabase.from('tenants').select('phone, lead_intake_token').eq('id', channel.tenant_id).maybeSingle()
        ownerPhone = tBase?.phone || ''
        leadToken = tBase?.lead_intake_token || ''
      }
      ownerPhone = ownerPhone || agent?.forward_to_phone || ''
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}" jitterBufferSize="small">
      <Parameter name="systemPrompt" value="${sp}"/>
      <Parameter name="greeting" value="${escapeXml(greeting)}"/>
      <Parameter name="ownerPhone" value="${escapeXml(ownerPhone)}"/>
      <Parameter name="fromNumber" value="${escapeXml(toNormalized)}"/>
      <Parameter name="leadToken" value="${escapeXml(leadToken)}"/>
      <Parameter name="callerNumber" value="${escapeXml(From || '')}"/>
      <Parameter name="voiceId" value="${escapeXml(langCfg.voiceId)}"/>
      <Parameter name="language" value="${escapeXml(langCfg.stt)}"/>
    </Stream>
  </Connect>
</Response>`
      return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
    }

    // ── FALLBACK (original flow): Twilio <Gather> speech + Deepgram/Polly TTS.
    // Used when no voice-server is configured. Kept intact on purpose.
    const action = gatherUrl(baseUrl)
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US" timeout="10">
    ${ttsPlay(greeting)}
  </Gather>
  ${ttsPlay("I didn't hear anything. Please call us back. Goodbye!")}
</Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  const action = gatherUrl(baseUrl)
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US" timeout="10">
    ${ttsPlay("Hello! Thank you for calling. How can I help you today?")}
  </Gather>
  ${ttsPlay("I didn't hear anything. Please call us back. Goodbye!")}
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
