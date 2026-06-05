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
  const { From, To } = params
  // SpeechResult key present = Gather callback (even if empty string = couldn't transcribe)
  const isGatherCallback = 'SpeechResult' in params
  const SpeechResult = params.SpeechResult || ''

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
  const supabase = await createServiceClient()

  // Look up tenant by phone number — match any channel type (sms or voice)
  const { data: channel } = await supabase
    .from('channels')
    .select('tenant_id')
    .eq('twilio_number', To)
    .maybeSingle()

  // Handle Gather callback (user spoke or silence after greeting)
  if (isGatherCallback) {
    if (!SpeechResult) {
      // Couldn't transcribe — ask to repeat
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${baseUrl}/api/webhooks/twilio/voice" method="POST" speechTimeout="auto" language="en-US" timeout="10">
    <Say voice="Polly.Joanna">I'm sorry, I didn't catch that. Could you please repeat your question?</Say>
  </Gather>
  <Say voice="Polly.Joanna">I still couldn't hear you. Please call us back and we'll be happy to help. Goodbye!</Say>
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
        })

        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${baseUrl}/api/webhooks/twilio/voice" method="POST" speechTimeout="auto" language="en-US" timeout="10">
    <Say voice="Polly.Joanna">${escapeXml(result.response)}</Say>
  </Gather>
  <Say voice="Polly.Joanna">Is there anything else I can help you with? Please call back if you need assistance. Goodbye!</Say>
</Response>`
        return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
      } catch (err) {
        console.error('Voice pipeline error:', err)
      }
    }

    // Fallback if no channel or pipeline error
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I'm sorry, I'm having trouble right now. Please call back and we'll be happy to help. Goodbye!</Say>
</Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // Fresh call — load and play greeting
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
  <Gather input="speech" action="${baseUrl}/api/webhooks/twilio/voice" method="POST" speechTimeout="auto" language="en-US" timeout="10">
    <Say voice="Polly.Joanna">${escapeXml(greeting)}</Say>
  </Gather>
  <Say voice="Polly.Joanna">I didn't catch that. Please call us back and we'll be happy to help. Goodbye!</Say>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
