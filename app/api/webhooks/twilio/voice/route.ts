import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { primaryAgent } from '@/lib/agents/primary'
import { verifyTwilio, shouldReject } from '@/lib/webhooks/verify'
import { runAIPipeline, DEFAULT_TONE } from '@/lib/anthropic/pipeline'
import { intakeLead } from '@/lib/leads/speed-to-lead'
import { stripMarkdown, NO_MARKDOWN_RULE } from '@/lib/utils'
import { requestBaseUrl } from '@/lib/request-url'
import { getBusinessTimezone } from '@/lib/timezone'
import { currentDateContext } from '@/lib/appointments'
import { catalogPromptLine } from '@/lib/stripe/connect'
import { assembleBusinessContext } from '@/lib/brain/context/orchestrate'
import { enforce, clientIp } from '@/lib/ratelimit'
import { assertPartnerActive, PAUSED_VOICE_MESSAGE } from '@/lib/billing/gate'

// How long the owner's phone rings before the AI receptionist takes over.
// ~12s ≈ 2-3 rings — short enough to take over before voicemail typically grabs the
// call; the AMD callback below is the backstop for when voicemail still answers.
const RING_TIMEOUT_SECONDS = 12

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
  const flood = await enforce('webhook', `twilio:${clientIp(req)}`)
  if (flood) return flood
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))

  // Signature verification is the primary security layer — a forged call is never processed.
  if (shouldReject(verifyTwilio(req, params))) {
    console.error('[voice] Twilio signature verification failed — rejecting.')
    return new NextResponse('Forbidden', { status: 403 })
  }

  const { From, To } = params
  const isGatherCallback = 'SpeechResult' in params
  const SpeechResult = params.SpeechResult || ''

  const conversationId = req.nextUrl.searchParams.get('cid') || undefined
  // Set by the voicemail rescue (amd callback) to skip forwarding and answer with the
  // FULL realtime agent. Does not affect the normal direct-answer or forward paths.
  const directAi = req.nextUrl.searchParams.get('ai') === '1'

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

  // WL prepaid billing gate — if the owning partner is paused/depleted/past-due, this number answers
  // with a brief paused message instead of engaging the (paid) AI receptionist, forwarding, or opening
  // a realtime stream. Covers the first turn and every gather turn. No-op for direct Scalix tenants and
  // while WL_BILLING_ENABLED is off.
  if (channel && !(await assertPartnerActive({ tenantId: channel.tenant_id })).ok) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${ttsPlay(PAUSED_VOICE_MESSAGE)}
  <Hangup/>
</Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
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
    const agentCols = 'id, forward_to_phone, greeting, status, system_prompt, name, business_name, voice, voice_language, business_hours'
    // A number with no agent bound to it falls back to the tenant's default agent. That fallback was
    // a bare maybeSingle(), so a tenant's second active employee turned it into null — no forwarding
    // number, no greeting, no prompt, on a live call. Bounded to one row now.
    const agent = channel.ai_employee_id
      ? (await supabase.from('ai_employees').select(agentCols).eq('id', channel.ai_employee_id).single()).data
      : await primaryAgent<{
          id: string
          forward_to_phone: string | null
          greeting: string | null
          status: string
          system_prompt: string | null
          name: string | null
          business_name: string | null
          voice: string | null
          voice_language: string | null
          business_hours: unknown
        }>(supabase, channel.tenant_id, agentCols)

    const forwardTo = agent?.forward_to_phone
    const greeting = agent?.greeting || 'Hello! Thank you for calling. How can I help you today?'

    if (forwardTo && !directAi) {
      // Same-domain rescue (Fix C): build callbacks from the host the call came in on,
      // so the AMD redirect + AI fallback stay on the same domain as this webhook.
      const reqBase = requestBaseUrl(req)
      const fallbackAction = `${reqBase}/api/webhooks/twilio/voice/ai-fallback`
      const amdCallback = `${reqBase}/api/webhooks/twilio/voice/amd`
      // Bill the owner-dial child leg: report its completion (with its own CallSid + duration) to the
      // voice-status route, which meters that leg's Twilio telephony once.
      const legStatus = `${reqBase}/api/webhooks/twilio/voice/status`
      // machineDetection on the dialed <Number> runs AMD on the owner's leg. If a
      // voicemail/machine answers, the amd callback redirects the caller to the AI.
      // answerOnBridge keeps the caller on ringback (not "answered") until a real
      // human bridge. action catches no-answer/busy/failed → AI. The machineDetection*
      // tuning makes AMD classify voicemail in a few seconds instead of up to 30.
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${RING_TIMEOUT_SECONDS}" action="${fallbackAction}" method="POST" answerOnBridge="true">
    <Number machineDetection="Enable" machineDetectionTimeout="5" machineDetectionSpeechThreshold="1900" machineDetectionSpeechEndThreshold="1000" machineDetectionSilenceTimeout="3000" amdStatusCallback="${amdCallback}" amdStatusCallbackMethod="POST" statusCallback="${legStatus}" statusCallbackEvent="completed" statusCallbackMethod="POST">${escapeXml(forwardTo)}</Number>
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
      const transferRule = `TRANSFERS: After booking an appointment or answering a routine question, DO NOT transfer the call — confirm the details once and let the call end normally. Only transfer to a human (transfer_to_human) when the caller EXPLICITLY asks to speak to a person.`
      const langCfg = voiceLangConfig(agent?.voice_language, agent?.voice)
      // The live agent runs its own TTS, so anything we strip afterwards never reaches the caller's ear.
      // NO_MARKDOWN_RULE is the whole defence on this path, and it's the wording every voice path shares.
      let voiceSystemPrompt = `${DEFAULT_TONE}\n\n${langCfg.promptLine}\n\nSpeak naturally in full sentences.\n${NO_MARKDOWN_RULE}\n\n${bookingRules}\n\n${transferRule}\n\n${baseVoicePrompt}`

      // Informational opening hours (business_hours JSON) — so phone callers who ask
      // "what are your hours?" get a real answer. Mirrors the SMS/WhatsApp prompt
      // (lib/anthropic/pipeline buildSystemPrompt). This is NOT appointment
      // availability (appointment_slots stays booking-only).
      const bizHours = (agent?.business_hours || {}) as Record<string, string>
      const hoursStr = Object.entries(bizHours).map(([day, h]) => `${day}: ${h}`).join(', ')
      if (hoursStr) {
        voiceSystemPrompt += `\n\nBUSINESS HOURS: ${hoursStr}. When a caller asks what hours you're open or whether you're open now, answer from these. (These are your open hours, not appointment availability.)`
      }

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

      // Owner phone for the lead-alert SMS. Try owner_phone (may not exist yet),
      // fall back to the business phone, then the call-forwarding number.
      let ownerPhone = ''
      let leadToken = ''
      let tenantTz: string | null = null
      const { data: tWith } = await supabase.from('tenants').select('owner_phone, phone, lead_intake_token, timezone').eq('id', channel.tenant_id).maybeSingle()
      if (tWith) {
        ownerPhone = tWith.owner_phone || tWith.phone || ''
        leadToken = tWith.lead_intake_token || ''
        tenantTz = tWith.timezone || null
      } else {
        const { data: tBase } = await supabase.from('tenants').select('phone, lead_intake_token, timezone').eq('id', channel.tenant_id).maybeSingle()
        ownerPhone = tBase?.phone || ''
        leadToken = tBase?.lead_intake_token || ''
        tenantTz = tBase?.timezone || null
      }

      // Live, per-call current date/day/time in THIS tenant's timezone — resolved with
      // the SAME function booking uses (agent tz → tenant tz → default) so the spoken
      // day and the booked slot always agree. Recomputed every call (this handler runs
      // per request), never frozen at deploy time.
      const tz = await getBusinessTimezone(channel.tenant_id, tenantTz)
      voiceSystemPrompt += `\n\n${currentDateContext(tz)}`

      // Stripe product catalog (cached) so the agent can offer real products and pass the
      // exact price_id to send_payment_link. No-op if the business hasn't connected Stripe.
      try { const payLine = await catalogPromptLine(channel.tenant_id); if (payLine) voiceSystemPrompt += `\n\n${payLine}` } catch { /* fail-safe */ }

      // The website catalogue, for a business small enough to carry the whole list in the prompt. Above
      // SNAPSHOT_MAX_PRODUCTS this returns null and the agent uses the search_catalog function instead.
      // Assembled here, at call SETUP, so it costs the caller nothing once the call is live.
      try {
        const { catalogSnapshot } = await import('@/lib/catalog/snapshot')
        const snapshot = await catalogSnapshot(channel.tenant_id)
        if (snapshot) voiceSystemPrompt += `\n\n${snapshot}`
        else voiceSystemPrompt += `\n\nPRODUCTS: Use the search_catalog function to look up any product, price, or availability before stating one. When it returns a price range, give the range and ask which version they mean — never read the versions out one by one.`
      } catch { /* fail-safe: the function still works without the prompt line */ }

      // Unified Business Context — realtime voice has no transcript at prompt-build time, so inject only the
      // small always-on essentials (business hours + location). Keeps the voice payload tight. Best-effort.
      try {
        const bizContext = await assembleBusinessContext({ tenantId: channel.tenant_id, agentId: agent?.id ?? null, channel: 'voice', query: '', contactId: null, essentialsOnly: true })
        if (bizContext) voiceSystemPrompt += `\n\n${bizContext}`
      } catch { /* fail-safe */ }

      const sp = escapeXml(voiceSystemPrompt)
      ownerPhone = ownerPhone || agent?.forward_to_phone || ''
      // Live-transfer target: ONLY this agent's own configured transfer number.
      // NEVER tenant.phone (the business-profile number / lead-SMS recipient).
      // Empty → the voice-server won't offer transfer_to_human, so the AI can't transfer.
      const transferNumber = agent?.forward_to_phone || ''
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}" jitterBufferSize="small">
      <Parameter name="systemPrompt" value="${sp}"/>
      <Parameter name="greeting" value="${escapeXml(greeting)}"/>
      <Parameter name="ownerPhone" value="${escapeXml(ownerPhone)}"/>
      <Parameter name="transferNumber" value="${escapeXml(transferNumber)}"/>
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
