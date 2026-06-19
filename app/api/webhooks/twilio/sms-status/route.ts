import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createServiceClient } from '@/lib/supabase/server'

// A2: Twilio delivery status callback. Twilio POSTs the async outcome of each
// outbound SMS here (queued → sent → delivered, or undelivered/failed with an
// ErrorCode like 30034). We record it on the matching messages row (by provider_sid)
// so failures surface in the Inbox instead of failing silently.
export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body)) as Record<string, string>

  // Validate the Twilio signature against the canonical callback URL we registered
  // (the same one sendSMS sets via NEXT_PUBLIC_APP_URL), so signing URL == verify URL.
  const signature = req.headers.get('x-twilio-signature') || ''
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/sms-status`
  const valid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN!, signature, url, params)
  if (!valid && process.env.NODE_ENV === 'production') {
    console.warn('[sms-status] signature validation failed for', params.MessageSid)
    return new NextResponse('Forbidden', { status: 403 })
  }

  const sid = params.MessageSid
  const status = params.MessageStatus // queued|sending|sent|delivered|undelivered|failed
  const errorCode = params.ErrorCode || null // e.g. 30034
  if (!sid || !status) return NextResponse.json({ ok: true })

  const supabase = await createServiceClient()
  const { error } = await supabase
    .from('messages')
    .update({ delivery_status: status, error_code: errorCode })
    .eq('provider_sid', sid)
  if (error) console.error('[sms-status] update failed for', sid, error.message)

  if (status === 'undelivered' || status === 'failed') {
    console.warn(`[sms-status] ${sid} ${status} error_code=${errorCode || 'none'}`)
  }

  return NextResponse.json({ ok: true })
}
