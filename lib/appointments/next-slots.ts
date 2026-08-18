import { createServiceClient } from '@/lib/supabase/server'
import { getBusinessTimezone } from '@/lib/timezone'
import { nowInTimezone, dayOfWeek, addDaysIso, slotMinutes, formatTime12, MIN_LEAD_TIME_MINUTES } from '@/lib/appointments'

// THE NEXT FEW SLOTS THIS BUSINESS ACTUALLY HAS FREE.
//
// Written for the reschedule flow (lib/appointments/move-request.ts) and NOT YET CALLED by anything.
// Standalone and useful on its own terms: any surface that needs "give me two or three real times"
// wants this rather than its own copy of the subtraction rules.
//
// /api/appointments/available answers "what is free on THIS date" for the phone agent, which is the
// right question when a customer has already named a day. A reschedule asks a different one: "give me
// two or three real times to offer, starting from now, skipping whatever is already taken."
//
// The subtraction rules are the same and they are not re-derived: an active slot for that weekday,
// not already booked by a non-cancelled appointment, not in the past, and not inside the lead-time
// buffer. Getting any of those wrong would offer a customer a time that cannot be honoured — which is
// worse than not offering at all, because they will have agreed to it.
//
// ONE EXCLUSION THIS ADDS: the appointment being moved. Its own slot is "taken" by itself, and
// offering somebody their existing time as an alternative reads as the software not knowing what it
// is doing.

export interface OfferedSlot {
  /** ISO date, the shape appointments.slot_date stores. */
  date: string
  /** "HH:MM", the shape appointments.slot_time stores. */
  time: string
  /** What the customer is actually shown: "Thursday 21 Aug, 11:00 AM". Kept so the reply can quote it. */
  label: string
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Thursday 21 Aug, 11:00 AM" — a date a person can act on without a calendar in front of them. */
export function slotLabel(dateIso: string, time: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`)
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${formatTime12(time)}`
}

/**
 * Up to `count` real, free, future slots — searching forward from today across `horizonDays`.
 *
 * Returns fewer than `count`, or none at all, rather than inventing any. A business with one free
 * slot in the next fortnight should offer one; a business with none has nothing to say and the caller
 * has to handle that rather than send a message promising options that do not exist.
 */
export async function nextFreeSlots(
  tenantId: string,
  opts: { count?: number; horizonDays?: number; excludeAppointmentId?: string } = {},
): Promise<OfferedSlot[]> {
  const count = opts.count ?? 3
  const horizon = opts.horizonDays ?? 14

  const db = await createServiceClient()
  const { data: tenant } = await db.from('tenants').select('id, timezone').eq('id', tenantId).maybeSingle()
  if (!tenant) return []

  const tz = await getBusinessTimezone(tenantId, tenant.timezone)
  const now = nowInTimezone(tz)

  const [{ data: allSlots }, { data: booked }] = await Promise.all([
    db.from('appointment_slots').select('slot_time, day_of_week').eq('tenant_id', tenantId).eq('is_active', true),
    db.from('appointments').select('id, slot_date, slot_time').eq('tenant_id', tenantId)
      .gte('slot_date', now.dateIso).neq('status', 'cancelled'),
  ])

  const byDow = new Map<number, string[]>()
  for (const s of allSlots ?? []) {
    const a = byDow.get(s.day_of_week as number) ?? []
    a.push(String(s.slot_time))
    byDow.set(s.day_of_week as number, a)
  }

  const takenByDate = new Map<string, Set<string>>()
  for (const b of booked ?? []) {
    // The appointment being moved does not block its own alternatives.
    if (opts.excludeAppointmentId && b.id === opts.excludeAppointmentId) continue
    const k = String(b.slot_date)
    const set = takenByDate.get(k) ?? new Set<string>()
    set.add(String(b.slot_time))
    takenByDate.set(k, set)
  }

  const out: OfferedSlot[] = []
  for (let i = 0; i < horizon && out.length < count; i++) {
    const date = addDaysIso(now.dateIso, i)
    const taken = takenByDate.get(date) ?? new Set<string>()
    let times = (byDow.get(dayOfWeek(date)) ?? []).filter((t) => !taken.has(t))
    // Today is filtered by the same lead-time buffer the booking path uses. A slot forty minutes from
    // now is not an option anybody can act on.
    if (date === now.dateIso) {
      const threshold = now.minutes + MIN_LEAD_TIME_MINUTES
      times = times.filter((t) => slotMinutes(t) >= threshold)
    }
    for (const t of times.sort()) {
      if (out.length >= count) break
      out.push({ date, time: t, label: slotLabel(date, t) })
    }
  }
  return out
}
