import { NextRequest, NextResponse } from 'next/server'
import { sendSMS } from '@/lib/twilio/client'

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function xml(body: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    headers: { 'Content-Type': 'text/xml' },
  })
}

// Twilio calls this when the live-transfer <Dial> to the owner ends. If the
// owner answered (completed) the call is over. Otherwise (no-answer/busy/failed)
// text the owner so they can call the customer back, and let the caller know.
export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))
  const dialStatus = params.DialCallStatus

  const sp = req.nextUrl.searchParams
  const owner = sp.get('owner') || ''
  const from = sp.get('from') || ''
  const caller = sp.get('caller') || ''
  const reason = sp.get('reason') || ''

  if (dialStatus === 'completed') {
    // Owner answered and the call finished.
    return xml('<Response><Hangup/></Response>')
  }

  // Owner didn't pick up — SMS them the lead so they can call back.
  if (owner) {
    try {
      await sendSMS(
        owner,
        `🚨 Missed live transfer!\nCaller: ${caller || 'Unknown'}\nReason: ${reason || 'Not specified'}\nCall them back NOW — they were waiting.`,
        from || undefined,
      )
    } catch (err) {
      console.error('[handoff-fallback] SMS error:', err instanceof Error ? err.message : err)
    }
  }

  return xml(
    `<Response><Say voice="Polly.Joanna-Neural">${escapeXml("Sorry, we couldn't reach someone right now. We'll call you right back.")}</Say><Hangup/></Response>`,
  )
}
