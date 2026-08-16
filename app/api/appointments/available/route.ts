import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { parseDate, dayOfWeek, formatTime12, MIN_LEAD_TIME_MINUTES, nowInTimezone, slotMinutes, addDaysIso } from '@/lib/appointments'
import { getBusinessTimezone } from '@/lib/timezone'
import { enabledModulesOf } from '@/lib/modules'

// GET ?lead_token=…&date=… → { date, slots: ["9:00 AM", …] }
// Tenant is resolved from the lead token (not a spoofable tenant_id). Slots are
// computed in the BUSINESS timezone: never returns a slot in the past or within the
// minimum lead-time buffer; for "today" with nothing left, rolls forward to the
// earliest future day that has slots ("ASAP"). No-double-booking subtraction intact.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const leadToken = sp.get('lead_token') || ''
  const dateInput = sp.get('date') || ''
  if (!leadToken || !dateInput) {
    return NextResponse.json({ slots: [], error: 'lead_token and date are required' }, { status: 400 })
  }

  const supabase = await createServiceClient()
  const { data: tenant } = await supabase.from('tenants').select('id, timezone, enabled_modules').eq('lead_intake_token', leadToken).maybeSingle()
  if (!tenant) return NextResponse.json({ slots: [], error: 'invalid token' }, { status: 404 })

  // THE ROUTE IS THE GATE, not the tool list. What the model is offered decides what it says; THIS
  // decides what happens. A business that has not turned scheduling on has no availability to give,
  // and until now this route would have answered anyway — to voice-server, to a curl, to anything
  // holding the token. Same shape as /api/catalog/lookup's `inventory` check.
  if (!enabledModulesOf(tenant).includes('scheduling')) {
    return NextResponse.json({ slots: [], error: 'Booking is not enabled for this business.' })
  }

  const tz = await getBusinessTimezone(tenant.id, tenant.timezone)
  const dateIso = parseDate(dateInput, tz) // "today"/"tomorrow" resolved in the business tz
  if (!dateIso) return NextResponse.json({ slots: [], error: 'could not understand the date' })

  const now = nowInTimezone(tz)
  if (dateIso < now.dateIso) return NextResponse.json({ date: dateIso, slots: [] }) // past date → nothing

  // Load all active slots (by weekday) + booked appointments from today forward — so we
  // can both subtract booked times and roll forward across days for "ASAP".
  const [{ data: allSlots }, { data: booked }] = await Promise.all([
    supabase.from('appointment_slots').select('slot_time, day_of_week').eq('tenant_id', tenant.id).eq('is_active', true),
    supabase.from('appointments').select('slot_date, slot_time').eq('tenant_id', tenant.id).gte('slot_date', now.dateIso).neq('status', 'cancelled'),
  ])
  const slotsByDow = new Map<number, string[]>()
  for (const s of allSlots || []) {
    const a = slotsByDow.get(s.day_of_week) || []
    a.push(String(s.slot_time)); slotsByDow.set(s.day_of_week, a)
  }
  const bookedByDate = new Map<string, Set<string>>()
  for (const b of booked || []) {
    const k = String(b.slot_date), set = bookedByDate.get(k) || new Set<string>()
    set.add(String(b.slot_time)); bookedByDate.set(k, set)
  }

  // Valid, future, unbooked slots for a date (formatted). Today is filtered by now+buffer.
  const validForDate = (d: string): string[] => {
    const taken = bookedByDate.get(d) || new Set<string>()
    let times = (slotsByDow.get(dayOfWeek(d)) || []).filter((t) => !taken.has(t))
    if (d === now.dateIso) {
      const threshold = now.minutes + MIN_LEAD_TIME_MINUTES
      times = times.filter((t) => slotMinutes(t) >= threshold)
    }
    return times.sort().map((t) => formatTime12(t))
  }

  let outDate = dateIso
  let slots = validForDate(dateIso)
  // ASAP: only when "today" has nothing left, roll forward to the next day with slots.
  if (slots.length === 0 && dateIso === now.dateIso) {
    for (let i = 1; i <= 14; i++) {
      const d = addDaysIso(dateIso, i)
      const s = validForDate(d)
      if (s.length) { outDate = d; slots = s; break }
    }
  }

  return NextResponse.json({ date: outDate, slots })
}
