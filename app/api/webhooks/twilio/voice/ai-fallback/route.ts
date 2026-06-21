import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requestBaseUrl } from '@/lib/request-url'

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Speak via Deepgram Aura TTS (served by /api/tts) when configured; fall back
// to Twilio Polly when no Deepgram key is set, so voice never breaks. baseUrl is the
// request host (Fix C) so the TTS URL stays on the call's domain.
function ttsPlay(text: string, baseUrl: string): string {
  if (process.env.DEEPGRAM_API_KEY) {
    return `<Play>${baseUrl}/api/tts?text=${encodeURIComponent(text)}</Play>`
  }
  return `<Say voice="Polly.Joanna-Neural">${escapeXml(text)}</Say>`
}

// Called when the <Dial> to the owner's phone ends (no-answer/busy/failed/completed),
// OR via a forced redirect from the AMD callback when voicemail/machine answered.
export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))
  const { To, DialCallStatus } = params
  // forced → the AMD callback sent the caller here off a voicemail bridge.
  const forced = req.nextUrl.searchParams.get('forced')

  // Fix C: same domain as the incoming call.
  const baseUrl = requestBaseUrl(req)

  // Voicemail rescue → hand off to the FULL realtime agent (same as the primary
  // answer path) via the main voice route with ?ai=1, instead of the degraded
  // turn-based fallback. (The AMD callback already routes there directly; this is a
  // belt-and-suspenders path if anything still hits ai-fallback?forced.)
  if (forced) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Redirect method="POST">${baseUrl}/api/webhooks/twilio/voice?ai=1</Redirect></Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // A real human answered and the call finished — nothing to do.
  if (DialCallStatus === 'completed') {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // Owner didn't answer (no-answer, busy, failed) — AI takes over
  const toNormalized = To?.startsWith('+') ? To : `+${To}`
  const supabase = await createServiceClient()
  const { data: channels } = await supabase
    .from('channels')
    .select('tenant_id, ai_employee_id')
    .eq('twilio_number', toNormalized)
    .limit(1)
  const channel = channels?.[0] ?? null

  let greeting = 'Hello! Thank you for calling. Sorry I missed you — how can I help?'
  if (channel) {
    const agentQuery = channel.ai_employee_id
      ? supabase.from('ai_employees').select('greeting').eq('id', channel.ai_employee_id).single()
      : supabase.from('ai_employees').select('greeting').eq('tenant_id', channel.tenant_id).eq('status', 'active').maybeSingle()
    const { data: employee } = await agentQuery
    if (employee?.greeting) greeting = employee.greeting
  }

  const actionUrl = `${baseUrl}/api/webhooks/twilio/voice`
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${actionUrl}" method="POST" speechTimeout="auto" language="en-US" timeout="10">
    ${ttsPlay(greeting, baseUrl)}
  </Gather>
  ${ttsPlay("I didn't catch that. Please call us back. Goodbye!", baseUrl)}
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
