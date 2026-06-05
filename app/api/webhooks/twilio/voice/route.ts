import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runAIPipeline } from '@/lib/anthropic/pipeline'

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

export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))
  const { From, To } = params
  const isGatherCallback = 'SpeechResult' in params
  const SpeechResult = params.SpeechResult || ''

  // Carry conversationId across turns via query param
  const conversationId = req.nextUrl.searchParams.get('cid') || undefined

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
  const supabase = await createServiceClient()

  const toNormalized = To?.startsWith('+') ? To : `+${To}`
  const { data: channels } = await supabase
    .from('channels')
    .select('tenant_id')
    .eq('twilio_number', toNormalized)
    .limit(1)
  const channel = channels?.[0] ?? null

  // Gather callback — user spoke
  if (isGatherCallback) {
    if (!SpeechResult) {
      const action = gatherUrl(baseUrl, conversationId)
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US" timeout="8">
    <Say voice="Polly.Joanna">Sorry, I didn't catch that. Go ahead.</Say>
  </Gather>
  <Say voice="Polly.Joanna">I couldn't hear you. Please call us back. Goodbye!</Say>
</Response>`
      return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
    }

    if (channel) {
      try {
        const result = await runAIPipeline({
          tenantId: channel.tenant_id,
          channelType: 'voice',
          from: From,
          messageContent: SpeechResult,
          conversationId,
        })

        const action = gatherUrl(baseUrl, result.conversationId)
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US" timeout="8">
    <Say voice="Polly.Joanna-Neural">${escapeXml(result.response)}</Say>
  </Gather>
  <Say voice="Polly.Joanna-Neural">Feel free to call back anytime. Goodbye!</Say>
</Response>`
        return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
      } catch (err) {
        console.error('Voice pipeline error:', err instanceof Error ? err.message : err)
        const action = gatherUrl(baseUrl, conversationId)
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US" timeout="8">
    <Say voice="Polly.Joanna-Neural">Sorry about that, I had a hiccup. What can I help you with?</Say>
  </Gather>
</Response>`
        return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
      }
    }
  }

  // Fresh call — load greeting
  let greeting = 'Hello! Thank you for calling. How can I help you today?'
  if (channel) {
    const { data: employee } = await supabase
      .from('ai_employees')
      .select('greeting')
      .eq('tenant_id', channel.tenant_id)
      .eq('status', 'active')
      .maybeSingle()
    if (employee?.greeting) greeting = employee.greeting
  }

  const action = gatherUrl(baseUrl)
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US" timeout="10">
    <Say voice="Polly.Joanna-Neural">${escapeXml(greeting)}</Say>
  </Gather>
  <Say voice="Polly.Joanna-Neural">I didn't hear anything. Please call us back. Goodbye!</Say>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
