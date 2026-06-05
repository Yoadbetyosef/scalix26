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

export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))
  const { From, To, SpeechResult } = params

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
  const supabase = await createServiceClient()

  // Look up tenant by phone number — match any channel type (sms or voice)
  const { data: channel } = await supabase
    .from('channels')
    .select('tenant_id')
    .eq('twilio_number', To)
    .maybeSingle()

  if (SpeechResult && channel) {
    try {
      const result = await runAIPipeline({
        tenantId: channel.tenant_id,
        channelType: 'voice',
        from: From,
        messageContent: SpeechResult,
      })

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${baseUrl}/api/webhooks/twilio/voice" method="POST" speechTimeout="auto" language="en-US">
    <Say voice="Polly.Joanna">${escapeXml(result.response)}</Say>
  </Gather>
  <Say voice="Polly.Joanna">Is there anything else I can help you with?</Say>
</Response>`
      return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
    } catch (err) {
      console.error('Voice pipeline error:', err)
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${baseUrl}/api/webhooks/twilio/voice" method="POST" speechTimeout="auto" language="en-US">
    <Say voice="Polly.Joanna">I'm sorry, I had trouble understanding that. Could you please repeat your question?</Say>
  </Gather>
</Response>`
      return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
    }
  }

  // Load greeting from the tenant's active AI employee
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

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${baseUrl}/api/webhooks/twilio/voice" method="POST" speechTimeout="auto" language="en-US" timeout="5">
    <Say voice="Polly.Joanna">${escapeXml(greeting)}</Say>
  </Gather>
  <Redirect method="POST">${baseUrl}/api/webhooks/twilio/voice</Redirect>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
