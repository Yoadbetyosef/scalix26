import { NextRequest, NextResponse } from 'next/server'

// TwiML response for incoming calls — gather speech, then process with AI
export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))
  const { CallSid, From, To, SpeechResult } = params

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL

  if (SpeechResult) {
    // Process the gathered speech through AI
    const res = await fetch(`${baseUrl}/api/ai/voice-respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid: CallSid, from: From, to: To, speech: SpeechResult }),
    })
    const { twiml } = await res.json()
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // Initial call — greet and gather
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${baseUrl}/api/webhooks/twilio/voice" method="POST" speechTimeout="auto" language="en-US">
    <Say voice="alice">Hello! Thank you for calling. How can I help you today?</Say>
  </Gather>
  <Say>I'm sorry, I didn't hear anything. Please call back and I'll be happy to help.</Say>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
