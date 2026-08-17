import { createServiceClient } from '@/lib/supabase/server'
import { getBusinessTimezone } from '@/lib/timezone'
import { parseDate, parseTime, dayOfWeek, nowInTimezone, slotMinutes, MIN_LEAD_TIME_MINUTES } from '@/lib/appointments'
import { normalizePhone } from '@/lib/contacts/store'
import { writeCapturedName, looksLikeCapturedName } from '@/lib/contacts/ai-name'
import { getCalendarAccess } from '@/lib/calendar/store'
import { createCalendarEvent } from '@/lib/calendar/google'
import { createMicrosoftCalendarEvent } from '@/lib/calendar/microsoft'
import { markLeadsBooked } from '@/lib/leads/booked'
import { enabledModulesOf } from '@/lib/modules'

// ONE INSERT, TWO POLICIES.
//
// An appointment can now be created by the AI — talking to a stranger, resolved from a lead token on
// a PUBLIC route — or by the owner, who is signed in and looking at their own calendar. Everything
// that makes an appointment an appointment is the same for both: the date parse, the contact, the
// row, the race-safe slot, the calendar mirror. What differs is what each is ALLOWED to do.
//
// So the difference is a policy object, not a second implementation and not a credential branch
// inside one handler. `/api/appointments/book` stays exactly what it was — public, token-keyed, for
// the AI. `/api/appointments` is the session route beside it.
//
// ── WHY THE OWNER IS NOT HELD TO THE SLOT GRID ──────────────────────────────────────────────────
//
// `appointment_slots` is what the business OFFERS STRANGERS. It is not a statement about what the
// owner may do, and treating it as one makes the feature useless: on the live tenant the grid has
// Sunday 9, Monday 9 and Tuesday 9–4, and nothing at all on Wednesday through Saturday — so an
// enforced grid would refuse most days of every week. Across the platform, 28 of 33 tenants have no
// grid at all and would be refused every date, forever.
//
// Double-booking is a different thing and is enforced for BOTH: it is not a policy, it is a fact
// about time. `uniq_appt_active_slot` raises 23505 and it is caught below.

export interface CreatePolicy {
  /** The AI offers only what the business advertises. The owner's own calendar is theirs. */
  enforceSlotGrid: boolean
  /** The AI must not book inside the lead-time buffer. An owner booking for 20 minutes' time is ordinary. */
  enforceLeadTime: boolean
  /** What the row records about where it came from. */
  channel: string
}

export const AI_POLICY: CreatePolicy = { enforceSlotGrid: true, enforceLeadTime: true, channel: 'voice' }
export const OWNER_POLICY: CreatePolicy = { enforceSlotGrid: false, enforceLeadTime: false, channel: 'owner' }

export interface CreateInput {
  tenantId: string
  /** "tomorrow", "June 15", or an ISO date. Parsed in the business timezone. */
  date: string
  time: string
  name: string | null
  phone: string
  email: string | null
  service: string | null
  meetingKind: string
  address: string | null
  joinUrl: string | null
  durationMinutes: number | null
}

export type CreateResult =
  | { ok: true; appointmentId: string; contactId: string | null; dateIso: string; timeDb: string; tz: string }
  | { ok: false; error: string; status?: number }

/** The four the column allows. A fifth would fail the CHECK and lose the booking. */
// FIVE, and the fifth carries the thing the other four never did: DIRECTION.
// on_site = we travel to them. at_business = they travel to us. Both are "in person"; only one wants
// an address, and conflating them is what had Rudi asking a jeweller's customer where they live.
export const MEETING_KINDS = ['on_site', 'at_business', 'zoom', 'google_meet', 'phone']

export async function createAppointment(input: CreateInput, policy: CreatePolicy): Promise<CreateResult> {
  const supabase = await createServiceClient()

  const { data: tenant } = await supabase
    .from('tenants').select('id, business_name, phone, email, timezone, enabled_modules').eq('id', input.tenantId).maybeSingle()
  if (!tenant) return { ok: false, error: 'invalid tenant', status: 404 }

  // THE REAL HOLE, CLOSED HERE RATHER THAN AT EITHER DOOR. Neither /book nor /api/appointments
  // checked this, so a tenant with `scheduling` off got appointments written to their table by phone
  // and nothing objected. It sits in the shared core because both doors write through it, and a
  // check duplicated at two entrances is one that will eventually only be true at one of them.
  //
  // No extra query: the tenant row is already being read for the timezone.
  if (!enabledModulesOf(tenant).includes('scheduling')) {
    return { ok: false, error: 'Booking is not enabled for this business.', status: 403 }
  }

  const timeDb = parseTime(input.time)
  if (!timeDb) return { ok: false, error: 'could not understand the time' }

  const tz = await getBusinessTimezone(tenant.id, tenant.timezone)
  const dateIso = parseDate(input.date, tz)
  if (!dateIso) return { ok: false, error: 'could not understand the date' }

  const now = nowInTimezone(tz)
  // BOTH policies refuse the past. Logging an appointment that already happened is a different
  // feature — backfilling history — and it should be decided deliberately, not fall out of a form.
  if (dateIso < now.dateIso) return { ok: false, error: 'that date has already passed' }
  if (policy.enforceLeadTime && dateIso === now.dateIso && slotMinutes(timeDb) < now.minutes + MIN_LEAD_TIME_MINUTES) {
    return { ok: false, error: 'that time has already passed — please pick a later time' }
  }
  if (!policy.enforceLeadTime && dateIso === now.dateIso && slotMinutes(timeDb) < now.minutes) {
    return { ok: false, error: 'that time has already passed today' }
  }

  if (policy.enforceSlotGrid) {
    const { data: slot } = await supabase.from('appointment_slots').select('id')
      .eq('tenant_id', tenant.id).eq('day_of_week', dayOfWeek(dateIso)).eq('slot_time', timeDb).eq('is_active', true).maybeSingle()
    if (!slot) return { ok: false, error: 'that time is not available' }
  }

  const { data: existing } = await supabase.from('appointments').select('id')
    .eq('tenant_id', tenant.id).eq('slot_date', dateIso).eq('slot_time', timeDb).neq('status', 'cancelled').maybeSingle()
  if (existing) return { ok: false, error: 'that time was just taken' }

  // ── THE CONTACT, MATCHED ON DIGITS ───────────────────────────────────────────────────────────
  //
  // This used to be `.eq('phone', phone)` — an exact string match — which is how +19174954300,
  // (917) 495-4300 and 9174954300 became three contacts for one person on the live tenant
  // (OUTSTANDING §25). Normalised matching is the rule createContact, the importer and the drip
  // brake already use, and it can only find MORE existing people, never fewer.
  //
  // This changes the AI path too, deliberately: one insert with two matching rules is the drift this
  // codebase keeps finding.
  const key = normalizePhone(input.phone)
  let contactId: string | null = null
  if (key) {
    const { data: candidates } = await supabase
      .from('contacts').select('id, phone').eq('tenant_id', tenant.id).is('merged_into_id', null)
    const hit = ((candidates ?? []) as { id: string; phone: string | null }[])
      .find((c) => normalizePhone(c.phone) === key)
    if (hit) contactId = hit.id
  }
  if (contactId) {
    await writeCapturedName(supabase, contactId, input.name)
  } else {
    const { data: created } = await supabase.from('contacts')
      .insert({
        tenant_id: tenant.id, phone: input.phone,
        name: looksLikeCapturedName(input.name) ? input.name : null,
        channel: policy.channel === 'owner' ? null : policy.channel,
      })
      .select('id').single()
    contactId = created?.id ?? null
  }

  const kind = MEETING_KINDS.includes(input.meetingKind) ? input.meetingKind : 'on_site'
  const { data: appt, error: apptErr } = await supabase.from('appointments').insert({
    tenant_id: tenant.id, contact_id: contactId, slot_date: dateIso, slot_time: timeDb,
    customer_name: input.name, customer_phone: input.phone, customer_email: input.email,
    service_type: input.service, channel: policy.channel, status: 'confirmed',
    meeting_kind: kind, address: input.address, join_url: input.joinUrl, duration_minutes: input.durationMinutes,
  }).select('id').single()
  if (apptErr || !appt) {
    // Race-safe: the partial unique index raises 23505 when a near-simultaneous booking won the slot.
    // The same friendly answer as the pre-check, so the AI offers other times and never a hard error.
    if (apptErr?.code === '23505') return { ok: false, error: 'that time was just taken' }
    return { ok: false, error: apptErr?.message || 'failed to book', status: 500 }
  }

  await markLeadsBooked(supabase, tenant.id, contactId, input.phone)

  // Google / Microsoft calendar — ADDITIVE and FAIL-SAFE. The appointments row is the system of
  // record; any failure here logs and never affects the confirmed booking.
  try {
    const access = await getCalendarAccess(tenant.id)
    if (access) {
      const [h, m] = timeDb.split(':').map(Number)
      const mins = input.durationMinutes && input.durationMinutes > 0 ? input.durationMinutes : 60
      const end = new Date(Date.UTC(2000, 0, 1, h, m + mins))
      const eventInput = {
        summary: `${input.service || 'Appointment'} — ${input.name || 'Customer'}`,
        description: `Booked via ${policy.channel}.\nContact: ${input.phone}${input.email ? `\nEmail: ${input.email}` : ''}${input.address ? `\n${input.address}` : ''}${input.joinUrl ? `\n${input.joinUrl}` : ''}`,
        start: { dateTime: `${dateIso}T${timeDb}`, timeZone: tz },
        end: { dateTime: `${dateIso}T${String(end.getUTCHours()).padStart(2, '0')}:${String(end.getUTCMinutes()).padStart(2, '0')}:00`, timeZone: tz },
      }
      const ev = access.provider === 'microsoft'
        ? await createMicrosoftCalendarEvent(access.accessToken, eventInput)
        : await createCalendarEvent(access.accessToken, access.calendarId, eventInput)
      if (ev?.id) await supabase.from('appointments').update({ google_event_id: ev.id }).eq('id', appt.id)
    }
  } catch (err) {
    console.warn('[appointments] calendar sync failed (booking still confirmed):', err instanceof Error ? err.message : err)
  }

  return { ok: true, appointmentId: appt.id, contactId, dateIso, timeDb, tz }
}
