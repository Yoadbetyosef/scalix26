import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/twilio/client'
import { parseDate, parseTime, dayOfWeek, formatTime12 } from '@/lib/appointments'

function friendlyDate(dateIso: string): string {
  return new Date(`${dateIso}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  })
}

// POST { lead_token, date, time, customer_name?, customer_phone, service_type? }
export async function POST(req: NextRequest) {
  const data = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leadToken = typeof data.lead_token === 'string' ? data.lead_token : ''
  const name = typeof data.customer_name === 'string' && data.customer_name.trim() ? data.customer_name.trim() : null
  const phone = typeof data.customer_phone === 'string' ? data.customer_phone.trim() : ''
  const service = typeof data.service_type === 'string' && data.service_type.trim() ? data.service_type.trim() : null
  const dateIso = parseDate(typeof data.date === 'string' ? data.date : '')
  const timeDb = parseTime(typeof data.time === 'string' ? data.time : '')

  if (!leadToken || !phone) return NextResponse.json({ success: false, error: 'lead_token and customer_phone required' }, { status: 400 })
  if (!dateIso || !timeDb) return NextResponse.json({ success: false, error: 'could not understand the date or time' })

  const supabase = await createServiceClient()
  const { data: tenant } = await supabase
    .from('tenants').select('id, business_name, owner_phone, phone').eq('lead_intake_token', leadToken).maybeSingle()
  if (!tenant) return NextResponse.json({ success: false, error: 'invalid token' }, { status: 404 })

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
    customer_name: name, customer_phone: phone, service_type: service, status: 'confirmed',
  }).select('id').single()
  if (apptErr || !appt) return NextResponse.json({ success: false, error: apptErr?.message || 'failed to book' }, { status: 500 })

  // SMS confirmations (best-effort; never fail the booking on SMS errors).
  const { data: ch } = await supabase.from('channels').select('twilio_number')
    .eq('tenant_id', tenant.id).eq('type', 'sms').not('twilio_number', 'is', null).limit(1).maybeSingle()
  const fromNumber = ch?.twilio_number || undefined
  const business = tenant.business_name || 'us'
  const when = `${friendlyDate(dateIso)} at ${formatTime12(timeDb)}`
  const ownerPhone = tenant.owner_phone || tenant.phone
  try {
    await sendSMS(phone, `✅ Confirmed! Your appointment is on ${when}. See you then! - ${business}`, fromNumber)
    if (ownerPhone) {
      await sendSMS(ownerPhone, `📅 New appointment: ${name || 'Customer'} on ${when} for ${service || 'service'}. Phone: ${phone}`, fromNumber)
    }
  } catch (err) {
    console.error('[book] SMS failed:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ success: true, appointment_id: appt.id })
}
