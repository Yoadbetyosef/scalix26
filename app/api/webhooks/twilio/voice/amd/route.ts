import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { requestBaseUrl } from '@/lib/request-url'

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
const xml = () => new NextResponse(EMPTY_TWIML, { headers: { 'Content-Type': 'text/xml' } })

// Results that mean a HUMAN did NOT clearly pick up. 'unknown' is included so an
// ambiguous / too-short-to-classify voicemail still rolls the caller to the AI instead
// of leaving them stuck on the owner's voicemail. (Tradeoff: a real human the owner
// answered that AMD misreads as 'unknown' would be handed to the AI — rare; remove
// 'unknown' here if that is ever observed.)
const NOT_HUMAN = new Set(['machine_start', 'machine_end_beep', 'machine_end_silence', 'machine_end_other', 'fax', 'unknown'])

// amdStatusCallback for the <Dial><Number machineDetection>. Fires once Twilio
// classifies who answered the owner's leg. On a machine/voicemail/ambiguous answer we
// yank the CALLER (parent call) off the bridge and into the FULL realtime AI agent by
// redirecting to the main voice route with ?ai=1 (which skips forwarding). On a clear
// human, we do nothing and let the bridge proceed.
export async function POST(req: NextRequest) {
  const params = Object.fromEntries(new URLSearchParams(await req.text()))
  const answeredBy = params.AnsweredBy || ''
  const parentCallSid = params.ParentCallSid || ''
  const childCallSid = params.CallSid || ''
  console.log(`[voice][amd] AnsweredBy=${answeredBy} parent=${parentCallSid} child=${childCallSid}`)

  if (!NOT_HUMAN.has(answeredBy)) return xml() // clear human → keep the bridge

  // Same-domain (Fix C): build the redirect target from the host this callback came in
  // on, so the rescue stays on the domain the original call is using.
  const baseUrl = requestBaseUrl(req)
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (parentCallSid && sid && token && baseUrl) {
    try {
      await twilio(sid, token).calls(parentCallSid).update({
        method: 'POST',
        url: `${baseUrl}/api/webhooks/twilio/voice?ai=1`,
      })
      console.log(`[voice][amd] non-human (${answeredBy}) — redirected caller ${parentCallSid} to the full AI agent`)
    } catch (err) {
      console.error('[voice][amd] caller redirect failed:', err instanceof Error ? err.message : err)
    }
  } else {
    console.error('[voice][amd] cannot redirect — missing ParentCallSid / creds / baseUrl')
  }
  return xml()
}
