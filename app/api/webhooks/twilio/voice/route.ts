import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runAIPipeline } from '@/lib/anthropic/pipeline'
import { intakeLead } from '@/lib/leads/speed-to-lead'

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
  if (process.env.DEEPGRAM_API_KEY) {
    return `<Play>${process.env.NEXT_PUBLIC_APP_URL}/api/tts?text=${encodeURIComponent(text)}</Play>`
  }
  return `<Say voice="Polly.Joanna-Neural">${escapeXml(text)}</Say>`
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
      ? supabase.from('ai_employees').select('forward_to_phone, greeting, status, system_prompt, name, business_name').eq('id', channel.ai_employee_id).single()
      : supabase.from('ai_employees').select('forward_to_phone, greeting, status, system_prompt, name, business_name').eq('tenant_id', channel.tenant_id).eq('status', 'active').maybeSingle()

    const { data: agent } = await agentQuery

    const forwardTo = agent?.forward_to_phone
    const greeting = agent?.greeting || 'Hello! Thank you for calling. How can I help you today?'

    if (forwardTo) {
      const fallbackAction = `${baseUrl}/api/webhooks/twilio/voice/ai-fallback`
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="25" action="${fallbackAction}" method="POST">
    <Number>${escapeXml(forwardTo)}</Number>
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
      const voiceSystemPrompt = agent?.system_prompt && agent.system_prompt.trim().length > 0
        ? agent.system_prompt
        : `You are ${agent?.name || 'Alex'}, a professional AI receptionist for ${agent?.business_name || 'our company'}. Your job is to answer calls, help customers, and collect their information. Keep every response under 2 sentences. Be warm, friendly, and fast.`
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
