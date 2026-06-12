import { NextResponse } from 'next/server'

// Twilio calls this when the <Connect><Stream> media stream ends (the
// voice-server closed the socket or the call dropped). Nothing left to do —
// just end the call cleanly so Twilio doesn't 404 the action callback.
export async function POST() {
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
    { headers: { 'Content-Type': 'text/xml' } },
  )
}
