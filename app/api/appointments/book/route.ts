import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/twilio/client'
import { sendEmail, emailTemplates } from '@/lib/email/send'
import { parseDate, parseTime, dayOfWeek, formatTime12, MIN_LEAD_TIME_MINUTES, nowInTimezone, slotMinutes } from '@/lib/appointments'
import { getBusinessTimezone } from '@/lib/timezone'
import { getCalendarAccess } from '@/lib/calendar/store'
import { createCalendarEvent } from '@/lib/calendar/google'

function friendlyDate(dateIso: string): string {
  return new Date(`${dateIso}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  })
}

// POST { lead_token, date, time, customer_name?, customer_phone, customer_email?, service_type?, channel? }
export async function POST(req: NextRequest) {
  const data = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leadToken = typeof data.lead_token === 'string' ? data.lead_token : ''
  const name = typeof data.customer_name === 'string' && data.customer_name.trim() ? data.customer_name.trim() : null
  const phone = typeof data.customer_phone === 'string' ? data.customer_phone.trim() : ''
  const email = typeof data.customer_email === 'string' && data.customer_email.trim() ? data.customer_email.trim() : null
  const service = typeof data.service_type === 'string' && data.service_type.trim() ? data.service_type.trim() : null
  const channel = typeof data.channel === 'string' && data.channel.trim() ? data.channel.trim() : 'voice'
  // Optional: skip the customer confirmation SMS when the booking channel already
  // confirms in-channel via SMS (avoids texting the same number twice). Default
  // false → unchanged for voice / IG / FB.
  const suppressCustomerSms = data.suppress_customer_sms === true
  const timeDb = parseTime(typeof data.time === 'string' ? data.time : '')

  if (!leadToken || !phone) return NextResponse.json({ success: false, error: 'lead_token and customer_phone required' }, { status: 400 })
  if (!timeDb) return NextResponse.json({ success: false, error: 'could not understand the time' })

  const supabase = await createServiceClient()
  // NOTE: tenants has no owner_phone column — selecting it previously errored the
  // whole query, so tenant came back null and EVERY booking failed with "invalid
  // token" (0 appointments ever persisted). Owner contact = tenant.phone / email.
  const { data: tenant } = await supabase
    .from('tenants').select('id, business_name, phone, email, timezone').eq('lead_intake_token', leadToken).maybeSingle()
  if (!tenant) return NextResponse.json({ success: false, error: 'invalid token' }, { status: 404 })

  // Resolve the business timezone, then parse the date in it ("today"/"tomorrow").
  const tz = await getBusinessTimezone(tenant.id, tenant.timezone)
  const dateIso = parseDate(typeof data.date === 'string' ? data.date : '', tz)
  if (!dateIso) return NextResponse.json({ success: false, error: 'could not understand the date' })

  // Booking guard (defense in depth): never book a slot in the past or within the
  // minimum lead-time buffer, measured in the business timezone.
  const now = nowInTimezone(tz)
  if (dateIso < now.dateIso || (dateIso === now.dateIso && slotMinutes(timeDb) < now.minutes + MIN_LEAD_TIME_MINUTES)) {
    return NextResponse.json({ success: false, error: 'that time has already passed — please pick a later time' })
  }

  // The slot must exist for that weekday and not already be booked.
  const { data: slot } = await supabase.from('appointment_slots').select('id')
    .eq('tenant_id', tenant.id).eq('day_of_week', dayOfWeek(dateIso)).eq('slot_time', timeDb).eq('is_active', true).maybeSingle()
  if (!slot) return NextResponse.json({ success: false, error: 'that time is not available' })

  const { data: existing } = await supabase.from('appointments').select('id')
    .eq('tenant_id', tenant.id).eq('slot_date', dateIso).eq('slot_time', timeDb).neq('status', 'cancelled').maybeSingle()
  if (existing) return NextResponse.json({ success: false, error: 'that time was just taken' })

  // Find or create the contact.
  let contactId: string | null = null
  const { data: c } = await supabase.from('contacts').select('id').eq('tenant_id', tenant.id).eq('phone', phone).maybeSingle()
  if (c) {
    contactId = c.id
    if (name) await supabase.from('contacts').update({ name }).eq('id', contactId).is('name', null)
  } else {
    const { data: created } = await supabase.from('contacts').insert({ tenant_id: tenant.id, phone, name, channel: 'voice' }).select('id').single()
    contactId = created?.id ?? null
  }

  const { data: appt, error: apptErr } = await supabase.from('appointments').insert({
    tenant_id: tenant.id, contact_id: contactId, slot_date: dateIso, slot_time: timeDb,
    customer_name: name, customer_phone: phone, customer_email: email,
    service_type: service, channel, status: 'confirmed',
  }).select('id').single()
  if (apptErr || !appt) {
    // Race-safe: the partial unique index (tenant_id, slot_date, slot_time) raises
    // 23505 if a near-simultaneous booking won the slot. Surface the same friendly
    // message as the pre-check so the AI offers other times — never a hard error.
    if (apptErr?.code === '23505') return NextResponse.json({ success: false, error: 'that time was just taken' })
    return NextResponse.json({ success: false, error: apptErr?.message || 'failed to book' }, { status: 500 })
  }

  // Google Calendar (Phase 3a) — ADDITIVE + FAIL-SAFE. If the tenant has a calendar
  // connected, mirror the booking as an event and store its id. The appointments
  // row above is the system of record; ANY failure here only logs a warning and
  // never affects the confirmed booking. If not connected, this is a no-op.
  try {
    const access = await getCalendarAccess(tenant.id)
    if (access) {
      const tz = tenant.timezone || 'America/New_York'
      const [h, m] = timeDb.split(':').map(Number)
      const endH = String((h + 1) % 24).padStart(2, '0')
      const startDateTime = `${dateIso}T${timeDb}`
      const endDateTime = `${dateIso}T${endH}:${String(m).padStart(2, '0')}:00`
      const ev = await createCalendarEvent(access.accessToken, access.calendarId, {
        summary: `${service || 'Appointment'} — ${name || 'Customer'}`,
        description: `Booked by your AI via ${channel}.\nContact: ${phone}${email ? `\nEmail: ${email}` : ''}`,
        start: { dateTime: startDateTime, timeZone: tz },
        end: { dateTime: endDateTime, timeZone: tz },
      })
      if (ev?.id) await supabase.from('appointments').update({ google_event_id: ev.id }).eq('id', appt.id)
    }
  } catch (err) {
    console.warn('[book] calendar sync failed (booking still confirmed):', err instanceof Error ? err.message : err)
  }

  // Notify everyone (best-effort; never fail the confirmed booking on a send error).
  const { data: ch } = await supabase.from('channels').select('twilio_number')
    .eq('tenant_id', tenant.id).eq('type', 'sms').not('twilio_number', 'is', null).limit(1).maybeSingle()
  const fromNumber = ch?.twilio_number || undefined
  const business = tenant.business_name || 'us'
  const when = `${friendlyDate(dateIso)} at ${formatTime12(timeDb)}`

  // Owner contact resolved per-tenant (never hardcoded): tenant.phone, falling back
  // to the agent's forward number. Owner email = the tenant's account email.
  let ownerPhone = tenant.phone
  if (!ownerPhone) {
    const { data: ag } = await supabase.from('ai_employees').select('forward_to_phone')
      .eq('tenant_id', tenant.id).not('forward_to_phone', 'is', null).limit(1).maybeSingle()
    ownerPhone = ag?.forward_to_phone || null
  }
  const ownerEmail = tenant.email || null

  // 1) Customer → SMS confirmation, to the contact's number we already have.
  //    Skipped when the channel already confirms in-channel via SMS (suppress flag).
  if (!suppressCustomerSms) {
    try {
      await sendSMS(phone, `✅ Confirmed! Your appointment is on ${when}. See you then! - ${business}`, fromNumber)
    } catch (err) {
      console.error('[book] customer SMS failed:', err instanceof Error ? err.message : err)
    }
  }
  // 2) Owner → SMS + email that the AI booked an appointment.
  const ownerSms = `📅 New appointment: ${name || 'Customer'} on ${when} for ${service || 'service'}. Phone: ${phone}`
  if (ownerPhone) {
    try { await sendSMS(ownerPhone, ownerSms, fromNumber) }
    catch (err) { console.error('[book] owner SMS failed:', err instanceof Error ? err.message : err) }
  }
  if (ownerEmail) {
    try {
      const tmpl = emailTemplates.appointmentBooked({ business, customer: name || 'Customer', when, phone, service: service || 'Service', email, channel })
      await sendEmail(ownerEmail, tmpl.subject, tmpl.html)
    } catch (err) {
      console.error('[book] owner email failed:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ success: true, appointment_id: appt.id })
}
