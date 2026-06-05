import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Called by Twilio when the <Dial> to owner's phone ends (no answer, busy, or hung up)
export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))
  const { To, DialCallStatus } = params

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!

  // Only take over if owner didn't answer
  if (DialCallStatus === 'completed') {
    // Owner answered and finished — call is done
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // Owner didn't answer (no-answer, busy, failed) — AI takes over
  const toNormalized = To?.startsWith('+') ? To : `+${To}`
  const supabase = await createServiceClient()
  const { data: channels } = await supabase
    .from('channels')
    .select('tenant_id')
    .eq('twilio_number', toNormalized)
    .limit(1)
  const tenantId = channels?.[0]?.tenant_id

  let greeting = 'Hello! Thank you for calling. Sorry I missed you — how can I help?'
  if (tenantId) {
    const { data: employee } = await supabase
      .from('ai_employees')
      .select('greeting')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .maybeSingle()
    if (employee?.greeting) greeting = employee.greeting
  }

  const actionUrl = `${baseUrl}/api/webhooks/twilio/voice`
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${actionUrl}" method="POST" speechTimeout="auto" language="en-US" timeout="10">
    <Say voice="Polly.Joanna-Neural">${escapeXml(greeting)}</Say>
  </Gather>
  <Say voice="Polly.Joanna-Neural">I didn't catch that. Please call us back. Goodbye!</Say>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
