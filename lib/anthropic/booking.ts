import { anthropic, MODEL } from './client'

// The details we need to book an appointment.
export const BOOKING_FIELDS = ['service', 'date', 'time', 'name', 'phone', 'address'] as const

// ── THE ONES WITHOUT WHICH THERE IS NO APPOINTMENT ──────────────────────────────────────────────
//
// Everything else is worth asking for ONCE and booking without.
//
// This distinction did not exist, and its absence is a live defect. `buildBookingStatus` listed every
// missing field under "STILL MISSING" and said "Ask ONLY for the next missing field, one at a time
// … When all fields are collected, confirm". A customer who will not give a street address therefore
// never reaches "all collected", so the model asks again, and again, and never books.
//
// There is a real appointment in the database stuck in exactly that loop.
//
// A lost booking is worse than a missing address, and the agenda now has an amber row that shows the
// gap and offers the fix — so an appointment with no address is a visible, actionable state rather
// than a silent one. Asking twice and booking nothing is the worst of both.
export const BOOKING_REQUIRED = ['date', 'time', 'name', 'phone'] as const
export type BookingField = (typeof BOOKING_FIELDS)[number]
export type BookingFields = Record<BookingField, string | null>

type Msg = { role: string; content: string }

const BOOKING_KEYWORDS = [
  'book', 'booking', 'schedule', 'appointment', 'come out', 'send someone', 'come by',
  'available', 'availability', 'set up a', 'set me up', 'what time', 'what date',
  'reservar', 'cita', 'agendar',
]

// Cheap gate: only run the extraction when an appointment is actually being
// arranged, so normal conversations don't pay for an extra model call.
export function bookingInProgress(messages: Msg[]): boolean {
  const text = messages.map((m) => (m.content || '').toLowerCase()).join('\n')
  return BOOKING_KEYWORDS.some((k) => text.includes(k))
}

const EMPTY: BookingFields = { service: null, date: null, time: null, name: null, phone: null, address: null }

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t || /^(null|none|n\/a|unknown|tbd)$/i.test(t)) return null
  return t
}

// Ask the model to read the whole conversation and pull out any booking detail
// the customer gave OR the AI already confirmed. Returns nulls for missing.
export async function extractBookingFields(messages: Msg[]): Promise<BookingFields> {
  const transcript = messages
    .map((m) => `${m.role === 'assistant' ? 'AI' : 'Customer'}: ${m.content}`)
    .join('\n')
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 250,
      system:
        'Extract appointment-booking details from the conversation. Consider both what the customer said AND anything the AI already stated/confirmed. Return ONLY a JSON object with exactly these keys: service, date, time, name, phone, address. Use the value if present, otherwise null. Output JSON only, no prose.',
      messages: [{ role: 'user', content: transcript }],
    })
    const txt = res.content[0]?.type === 'text' ? res.content[0].text : ''
    const json = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)
    const p = JSON.parse(json) as Record<string, unknown>
    return {
      service: clean(p.service),
      date: clean(p.date),
      time: clean(p.time),
      name: clean(p.name),
      phone: clean(p.phone),
      address: clean(p.address),
    }
  } catch {
    return { ...EMPTY }
  }
}

// Turn the extracted fields into the "collected so far" block injected into the
// system prompt. Empty string when nothing has been collected yet.
export function buildBookingStatus(fields: BookingFields): string {
  const collected = BOOKING_FIELDS.filter((f) => fields[f])
  const missing = BOOKING_FIELDS.filter((f) => !fields[f])
  if (collected.length === 0) return ''

  const collectedStr = collected.map((f) => `${f}: ${fields[f]}`).join(', ')
  const required = missing.filter((f) => (BOOKING_REQUIRED as readonly string[]).includes(f))
  const optional = missing.filter((f) => !(BOOKING_REQUIRED as readonly string[]).includes(f))

  if (required.length === 0) {
    // Everything the booking NEEDS is here. Anything still missing is worth one ask and no more —
    // the instruction to book anyway is explicit, because without it the model keeps asking.
    const chase = optional.length
      ? ` If you have not already asked for ${optional.join(' and ')}, ask once. If the customer does not give it, BOOK ANYWAY and do not ask again.`
      : ''
    return `BOOKING STATUS — everything required is collected (${collectedStr}).${chase} Then book, confirm the appointment once, and stop asking questions.`
  }

  return `BOOKING IN PROGRESS.
ALREADY COLLECTED (do not ask for these again): ${collectedStr}.
STILL NEEDED: ${required.join(', ')}.${optional.length ? `\nNICE TO HAVE (ask once at most, then book without it): ${optional.join(', ')}.` : ''}
Ask ONLY for the next needed field, one at a time. Never re-ask for a field that is already collected. NEVER refuse to book because something in NICE TO HAVE is missing — book, and say you will pick the rest up later.`
}
