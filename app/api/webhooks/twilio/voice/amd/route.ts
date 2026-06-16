import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
const xml = () => new NextResponse(EMPTY_TWIML, { headers: { 'Content-Type': 'text/xml' } })

// Answering-machine results that mean a HUMAN did NOT pick up.
const MACHINE = new Set(['machine_start', 'machine_end_beep', 'machine_end_silence', 'machine_end_other', 'fax'])

// amdStatusCallback for the <Dial><Number machineDetection="Enable">. Fires once
// Twilio classifies who answered the owner's leg. On a machine/voicemail, we yank
// the CALLER (parent call) off the voicemail bridge and into the AI agent. On a
// human (or ambiguous 'unknown'), we do nothing and let the bridge proceed.
export async function POST(req: NextRequest) {
  const params = Object.fromEntries(new URLSearchParams(await req.text()))
  const answeredBy = params.AnsweredBy || ''
  const parentCallSid = params.ParentCallSid || ''
  const childCallSid = params.CallSid || ''
  console.log(`[voice][amd] AnsweredBy=${answeredBy} parent=${parentCallSid} child=${childCallSid}`)

  if (!MACHINE.has(answeredBy)) return xml() // human / unknown → keep the bridge

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (parentCallSid && sid && token) {
    try {
      await twilio(sid, token).calls(parentCallSid).update({
        method: 'POST',
        url: `${baseUrl}/api/webhooks/twilio/voice/ai-fallback?forced=machine`,
      })
      console.log(`[voice][amd] machine detected — redirected caller ${parentCallSid} to the AI`)
    } catch (err) {
      console.error('[voice][amd] caller redirect failed:', err instanceof Error ? err.message : err)
    }
  } else {
    console.error('[voice][amd] cannot redirect — missing ParentCallSid or Twilio creds')
  }
  return xml()
}
