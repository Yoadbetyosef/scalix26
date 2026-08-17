import { createAdminClient } from '@/lib/supabase/server'
import { getBusinessTimezone } from '@/lib/timezone'
import { nowInTimezone, formatTime12, slotMinutes } from '@/lib/appointments'
import { primaryAgent, agentByPersona } from '@/lib/agents/primary'
import { nameOf } from '@/lib/persona'

// THE AGENDA — docs/miles/appointments-agenda-v2.html, grouped by day.
//
// ── WHAT IS SHOWN ───────────────────────────────────────────────────────────────────────────────
//
// Today forward is the agenda, and it is what the reference draws. But the list this replaced had
// Past and Cancelled filters, and dropping them made two real things unreachable (OUTSTANDING §27).
//
// So: EARLIER runs the other way, under its own day groups, newest first, below the upcoming ones.
// Not a filter chip — an agenda you can point backwards stops being an agenda, and a chip that
// replaces the whole screen hides today to show last week. Days continue downward in the direction
// time does, which is the one arrangement that needs no explaining.
//
// It is bounded and it is loaded with the same read: EARLIER_DAYS back, which on real data is a
// handful of rows. Cancelled appointments appear ONLY there — a cancelled slot is not on your agenda,
// but "did I cancel that?" is a real question and the answer had nowhere to be.
//
// ── THE KIND IS READ, NEVER INFERRED ────────────────────────────────────────────────────────────
//
// `meeting_kind` comes off the column. Nothing here looks at `service_type` — one live row is called
// "Google Meet" and is a completed job somebody drove to, which is exactly why matching free text is
// forbidden. A row whose kind has never been set reads `on_site`, the column default, and that is
// true of every appointment booked before the column existed.
//
// ── MISSING SOMETHING ───────────────────────────────────────────────────────────────────────────
//
// An on-site job with no address, or a video call with no link, is a real state and the screen's
// whole reason for being: amber spine, the gap named, and the fix promoted to the first action. It is
// not an error and the database deliberately permits it — see the migration.
//
// AT_BUSINESS IS NEVER MISSING ANYTHING. The customer is coming to us, so the place is the tenant's
// own address and there was never a question to ask. Before the fifth kind existed these rows were
// `on_site` with no address and went amber forever — a screen insisting something was absent when
// nothing was. That was one bug in three places; this is the half of it that lives here.

export type MeetingKind = 'on_site' | 'at_business' | 'zoom' | 'google_meet' | 'phone'
export type Missing = 'address' | 'link' | null

export interface AgendaRow {
  id: string
  /** "9:00" — the phone's rail. */
  time: string
  /** "AM" — appended on a wide screen, where there is room for it. */
  meridiem: string
  /** "1H" phone · "1 HR" desktop. Both rendered; CSS shows one. */
  durationShort: string
  durationLong: string
  who: string
  service: string | null
  kind: MeetingKind
  /** The line under the service: an address, a link, or a number. */
  where: string | null
  joinUrl: string | null
  phone: string | null
  missing: Missing
  /** Which employee took the booking — from the CHANNEL it arrived on, which is how routing works. */
  by: string
  byPersona: 'rudi' | 'miles' | 'you'
  /** Now is inside this appointment's own window. */
  isNow: boolean
  /** Struck through and muted. Only ever true below the fold — a cancellation is not on your agenda. */
  cancelled: boolean
  /** Already happened. The row keeps its shape and loses its actions. */
  past: boolean
}

export interface AgendaDay {
  key: string
  /** "TODAY · FRI 15 AUG" */
  label: string
  count: number
  rows: AgendaRow[]
}

export interface Agenda {
  /** Today forward. The agenda proper. */
  days: AgendaDay[]
  /** Newest first, going back. Includes cancelled rows, which never appear above. */
  earlier: AgendaDay[]
  todayCount: number
  missingCount: number
}

/** How far back "earlier" reaches. Far enough to answer "what did I do last week". */
export const EARLIER_DAYS = 30

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

/** "FRI 15 AUG" from a plain date column, read as a date and never through a timezone it does not have. */
function dayStamp(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`)
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** 60 → 1H / 1 HR · 45 → 45M / 45 MIN. */
function durationLabels(minutes: number): { short: string; long: string } {
  if (minutes % 60 === 0) {
    const h = minutes / 60
    return { short: `${h}H`, long: `${h} HR` }
  }
  return { short: `${minutes}M`, long: `${minutes} MIN` }
}

interface Row {
  id: string
  slot_date: string
  slot_time: string
  customer_name: string | null
  customer_phone: string | null
  service_type: string | null
  status: string
  channel: string | null
  meeting_kind: string | null
  join_url: string | null
  address: string | null
  duration_minutes: number | null
}

const KINDS: MeetingKind[] = ['on_site', 'at_business', 'zoom', 'google_meet', 'phone']
const kindOf = (v: string | null): MeetingKind => (KINDS.includes(v as MeetingKind) ? (v as MeetingKind) : 'on_site')

/** The business's own address, assembled once. Null when the tenant has not filled it in. */
function businessAddress(t: { address?: string | null; city?: string | null; state?: string | null } | null): string | null {
  if (!t) return null
  const line = [t.address?.trim(), [t.city?.trim(), t.state?.trim()].filter(Boolean).join(', ')].filter(Boolean).join(', ')
  return line || null
}

/** The line under the service, and whether the thing that line needs is absent. */
function placeOf(kind: MeetingKind, r: Row, ownAddress: string | null): { where: string | null; missing: Missing } {
  if (kind === 'phone') return { where: r.customer_phone ? `Phone call · ${r.customer_phone}` : null, missing: null }
  // The customer comes to us. `missing` is null WHATEVER the tenant's address says — an owner who has
  // not filled in their own address knows where their shop is, and an amber row would be telling them
  // something they cannot usefully act on from an appointment screen.
  if (kind === 'at_business') return { where: ownAddress, missing: null }
  if (kind === 'zoom' || kind === 'google_meet') {
    const label = kind === 'zoom' ? 'Zoom' : 'Google Meet'
    return r.join_url
      ? { where: `${label} · ${r.join_url.replace(/^https?:\/\//, '')}`, missing: null }
      : { where: null, missing: 'link' }
  }
  return r.address ? { where: r.address, missing: null } : { where: null, missing: 'address' }
}

export async function readAgenda(tenantId: string): Promise<Agenda> {
  const db = createAdminClient()
  const { data: tenant } = await db
    .from('tenants').select('timezone, default_appointment_minutes, address, city, state').eq('id', tenantId).maybeSingle()
  const tz = await getBusinessTimezone(tenantId, tenant?.timezone ?? null)
  // Read ONCE for the whole agenda rather than per row — every at_business row shows the same line.
  const ownAddress = businessAddress(tenant as { address?: string | null; city?: string | null; state?: string | null } | null)
  const now = nowInTimezone(tz)
  // Nothing more specific was agreed, so the rail falls back to this rather than to a guess.
  const fallback = Number(tenant?.default_appointment_minutes) || 60

  // One window covering both directions, one read. The split happens below.
  const from = new Date(`${now.dateIso}T12:00:00Z`)
  from.setUTCDate(from.getUTCDate() - EARLIER_DAYS)
  const fromIso = from.toISOString().slice(0, 10)

  const [{ data }, phoneAgent, textAgent] = await Promise.all([
    db
      .from('appointments')
      .select('id, slot_date, slot_time, customer_name, customer_phone, service_type, status, channel, meeting_kind, join_url, address, duration_minutes')
      .eq('tenant_id', tenantId)
      .gte('slot_date', fromIso)
      .order('slot_date', { ascending: true })
      .order('slot_time', { ascending: true }),
    primaryAgent<{ name: string | null; persona: string | null }>(db, tenantId, 'name, persona'),
    agentByPersona<{ name: string | null; persona: string | null }>(db, tenantId, 'miles', 'name, persona'),
  ])

  const all = (data ?? []) as unknown as Row[]
  // A cancelled appointment is not on your agenda. It IS part of the record, so it survives below.
  const rows = all.filter((r) => r.slot_date >= now.dateIso ? r.status !== 'cancelled' : true)
  const days = new Map<string, AgendaDay>()
  const past = new Map<string, AgendaDay>()
  let missingCount = 0

  for (const r of rows) {
    const isPast = r.slot_date < now.dateIso
    const kind = kindOf(r.meeting_kind)
    const { where, missing } = placeOf(kind, r, ownAddress)
    // Only what is still ahead can need something. A gap on a job that has already happened is
    // history, and counting it would put a number in the opening line nobody can act on.
    if (missing && !isPast) missingCount++

    const minutes = r.duration_minutes && r.duration_minutes > 0 ? r.duration_minutes : fallback
    const { short, long } = durationLabels(minutes)
    const start = slotMinutes(r.slot_time)
    const twelve = formatTime12(String(r.slot_time))          // "9:00 AM"
    const [clock, meridiem] = twelve.split(' ')

    // WHO TOOK IT, from the channel it arrived on — which is how inbound routing actually works: the
    // phone employee answers calls, the messages employee answers everything typed. Not a guess about
    // the row; a statement about the door it came through. A booking made BY the owner would read
    // YOU, and nothing can produce one yet — there is no owner-side create (OUTSTANDING §26).
    const typed = r.channel === 'sms' || r.channel === 'instagram' || r.channel === 'facebook' || r.channel === 'email'
    const agent = typed ? (textAgent ?? phoneAgent) : phoneAgent
    const persona = ((agent as { persona?: string | null } | null)?.persona === 'miles' ? 'miles' : 'rudi') as 'rudi' | 'miles'

    const bucket = isPast ? past : days
    const day = bucket.get(r.slot_date) ?? {
      key: r.slot_date,
      label: r.slot_date === now.dateIso
        ? `TODAY · ${dayStamp(r.slot_date)}`
        : `${dayStamp(r.slot_date)}`,
      count: 0,
      rows: [],
    }
    day.rows.push({
      id: r.id,
      time: clock ?? twelve,
      meridiem: meridiem ?? '',
      durationShort: short,
      durationLong: long,
      who: r.customer_name?.trim() || r.customer_phone?.trim() || 'Someone',
      service: r.service_type?.trim() || null,
      kind,
      where,
      joinUrl: r.join_url,
      phone: r.customer_phone,
      missing,
      by: agent ? nameOf(agent) : 'Your AI',
      byPersona: persona,
      // Inside its own window, measured in the business timezone the slot was booked in.
      isNow: r.slot_date === now.dateIso && now.minutes >= start && now.minutes < start + minutes,
      cancelled: r.status === 'cancelled',
      past: isPast,
    })
    day.count = day.rows.length
    bucket.set(r.slot_date, day)
  }

  // TOMORROW earns its own word; every other day is just its stamp.
  const tomorrow = new Date(`${now.dateIso}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const tomorrowIso = tomorrow.toISOString().slice(0, 10)
  const out = [...days.values()].map((d) =>
    d.key === tomorrowIso ? { ...d, label: `TOMORROW · ${dayStamp(d.key)}` } : d,
  )

  // YESTERDAY earns a word too, and the rest run backwards from it.
  const yest = new Date(`${now.dateIso}T12:00:00Z`)
  yest.setUTCDate(yest.getUTCDate() - 1)
  const yesterdayIso = yest.toISOString().slice(0, 10)
  const earlier = [...past.values()]
    .sort((a, b) => (a.key < b.key ? 1 : -1))
    .map((d) => (d.key === yesterdayIso ? { ...d, label: `YESTERDAY · ${dayStamp(d.key)}` } : d))
    // Each day reads latest-first going back, the same direction the days themselves run.
    .map((d) => ({ ...d, rows: [...d.rows].reverse() }))

  return {
    days: out,
    earlier,
    todayCount: days.get(now.dateIso)?.count ?? 0,
    missingCount,
  }
}


// ── WHAT THE OWNER'S FORM OFFERS ────────────────────────────────────────────────────────────────
//
// The business's own slot grid plus what is already taken, so the New sheet can show that day's free
// times as one-tap chips. OFFERED, never enforced — see /api/appointments, where the owner policy
// deliberately does not hold the grid against them.

export interface SlotGrid {
  byDow: Record<number, string[]>
  booked: Record<string, string[]>
}

/** Bounded to the window somebody would actually book into from a form. */
export const GRID_DAYS = 90

export async function readSlotGrid(tenantId: string): Promise<SlotGrid> {
  const db = createAdminClient()
  const { data: t } = await db.from('tenants').select('timezone').eq('id', tenantId).maybeSingle()
  const tz = await getBusinessTimezone(tenantId, t?.timezone ?? null)
  const now = nowInTimezone(tz)
  const until = new Date(`${now.dateIso}T12:00:00Z`)
  until.setUTCDate(until.getUTCDate() + GRID_DAYS)

  const [slots, booked] = await Promise.all([
    db.from('appointment_slots').select('day_of_week, slot_time').eq('tenant_id', tenantId).eq('is_active', true),
    db.from('appointments').select('slot_date, slot_time')
      .eq('tenant_id', tenantId).gte('slot_date', now.dateIso).lte('slot_date', until.toISOString().slice(0, 10))
      .neq('status', 'cancelled'),
  ])

  const byDow: Record<number, string[]> = {}
  for (const r of (slots.data ?? []) as { day_of_week: number; slot_time: string }[]) {
    (byDow[r.day_of_week] ??= []).push(String(r.slot_time))
  }
  for (const k of Object.keys(byDow)) byDow[Number(k)].sort()

  const taken: Record<string, string[]> = {}
  for (const r of (booked.data ?? []) as { slot_date: string; slot_time: string }[]) {
    (taken[r.slot_date] ??= []).push(String(r.slot_time))
  }
  return { byDow, booked: taken }
}
