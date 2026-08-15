import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createAppointment, AI_POLICY, MEETING_KINDS } from '@/lib/appointments/create'
import { notifyBooking } from '@/lib/appointments/notify'

// THE AI'S BOOKING ENDPOINT. Public, keyed by the tenant's secret lead token — voice-server and the
// text pipeline both post here, and neither has a session.
//
// Everything that makes an appointment now lives in lib/appointments/create.ts, shared with the
// owner's session route. What stays here is what is TRUE OF THIS DOOR: the token resolves the tenant,
// the AI is held to the slot grid and the lead-time buffer, and both parties are told.
//
// POST { lead_token, date, time, customer_name?, customer_phone, customer_email?, service_type?,
//        channel?, meeting_kind?, address?, join_url?, duration_minutes?, suppress_customer_sms? }
export async function POST(req: NextRequest) {
  const data = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leadToken = typeof data.lead_token === 'string' ? data.lead_token : ''
  const phone = typeof data.customer_phone === 'string' ? data.customer_phone.trim() : ''
  const channel = typeof data.channel === 'string' && data.channel.trim() ? data.channel.trim() : 'voice'
  // Skip the customer confirmation when the booking channel already confirms in-channel via SMS,
  // so the same number is not texted twice. Default false → unchanged for voice / IG / FB.
  const suppressCustomerSms = data.suppress_customer_sms === true

  if (!leadToken || !phone) {
    return NextResponse.json({ success: false, error: 'lead_token and customer_phone required' }, { status: 400 })
  }

  const supabase = await createServiceClient()
  // NOTE: tenants has no owner_phone column — selecting it previously errored the whole query, so
  // tenant came back null and EVERY booking failed with "invalid token" (0 appointments persisted).
  const { data: tenant } = await supabase
    .from('tenants').select('id').eq('lead_intake_token', leadToken).maybeSingle()
  if (!tenant) return NextResponse.json({ success: false, error: 'invalid token' }, { status: 404 })

  // All four are OPTIONAL and none can fail a booking — a model that cannot fill one must still be
  // able to book. An unrecognised kind becomes on_site; a join_url that is not a link is dropped.
  const kindIn = typeof data.meeting_kind === 'string' ? data.meeting_kind.trim().toLowerCase() : ''
  const joinRaw = typeof data.join_url === 'string' ? data.join_url.trim() : ''
  const durRaw = typeof data.duration_minutes === 'number' ? Math.round(data.duration_minutes) : null

  const name = typeof data.customer_name === 'string' && data.customer_name.trim() ? data.customer_name.trim() : null
  const result = await createAppointment({
    tenantId: tenant.id,
    date: typeof data.date === 'string' ? data.date : '',
    time: typeof data.time === 'string' ? data.time : '',
    name,
    phone,
    email: typeof data.customer_email === 'string' && data.customer_email.trim() ? data.customer_email.trim() : null,
    service: typeof data.service_type === 'string' && data.service_type.trim() ? data.service_type.trim() : null,
    meetingKind: MEETING_KINDS.includes(kindIn) ? kindIn : 'on_site',
    address: typeof data.address === 'string' && data.address.trim() ? data.address.trim() : null,
    joinUrl: /^https?:\/\/\S+$/i.test(joinRaw) ? joinRaw : null,
    durationMinutes: durRaw && durRaw >= 5 && durRaw <= 480 ? durRaw : null,
  }, { ...AI_POLICY, channel })

  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, result.status ? { status: result.status } : undefined)
  }

  // The stranger gets a confirmation and the owner is told a thing happened while they were not
  // looking. Both are right for THIS door; see lib/appointments/notify.ts for why the owner's own
  // route answers differently.
  await notifyBooking({
    tenantId: tenant.id, dateIso: result.dateIso, timeDb: result.timeDb,
    name, phone,
    email: typeof data.customer_email === 'string' ? data.customer_email.trim() || null : null,
    service: typeof data.service_type === 'string' ? data.service_type.trim() || null : null,
    channel,
    customer: !suppressCustomerSms,
    owner: true,
  })

  return NextResponse.json({ success: true, appointment_id: result.appointmentId })
}
