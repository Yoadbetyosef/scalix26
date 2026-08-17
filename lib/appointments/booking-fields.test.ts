import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { BOOKING_FIELDS, BOOKING_REQUIRED, buildBookingStatus } from '@/lib/anthropic/booking'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const route = read('../../app/api/appointments/book/route.ts')
const core = read('./create.ts')
const textTool = read('../anthropic/booking-tools.ts')
const voiceTool = read('../../voice-server/server.js')

const F = (over: Partial<Record<string, string | null>> = {}) => ({
  service: 'AC repair', date: 'Friday', time: '11am', name: 'Yoad', phone: '+1917', address: null, ...over,
}) as Parameters<typeof buildBookingStatus>[0]

describe('a missing address must not cost the booking', () => {
  it('address is NOT required, and the four that are, are', () => {
    // The live 11:00 appointment is stuck in this exact loop: every field was listed as required, the
    // prompt said "ask for the next missing field" and "when all are collected, confirm" — so a
    // customer who will not give an address never reaches a booking.
    expect([...BOOKING_REQUIRED]).toEqual(['date', 'time', 'name', 'phone'])
    expect([...BOOKING_FIELDS]).toContain('address')
    expect(BOOKING_REQUIRED as readonly string[]).not.toContain('address')
  })

  it('tells the model to book anyway, in those words', () => {
    const status = buildBookingStatus(F())
    expect(status).toContain('BOOK ANYWAY')
    expect(status).toContain('do not ask again')
    // And it does NOT say everything is collected, because it is not.
    expect(status).toContain('everything required is collected')
  })

  it('once the address IS there, it just books', () => {
    const status = buildBookingStatus(F({ address: '140 Main St' }))
    expect(status).not.toContain('BOOK ANYWAY')
    expect(status).toContain('stop asking questions')
  })

  it('still chases what a booking genuinely cannot do without', () => {
    const status = buildBookingStatus(F({ phone: null, address: null }))
    expect(status).toContain('STILL NEEDED: phone')
    expect(status).toContain('NICE TO HAVE (ask once at most, then book without it): address')
    expect(status).toContain('NEVER refuse to book')
  })

  it('says nothing at all before anything has been collected', () => {
    expect(buildBookingStatus({ service: null, date: null, time: null, name: null, phone: null, address: null })).toBe('')
  })
})

describe('both tools send the same fields', () => {
  it('the text pipeline and the voice server carry identical schemas', () => {
    for (const src of [textTool, voiceTool]) {
      expect(src).toContain("enum: ['on_site', 'at_business', 'zoom', 'google_meet', 'phone']")
        // The fifth kind carries DIRECTION, and the tool must say so — on_site and at_business
        // are both "in person" and only one of them wants an address.
        expect(src).toContain('YOU GO TO THEM')
        expect(src).toContain('THEY COME TO YOU')
        expect(src).toContain('ONLY for on_site')
      expect(src).toContain('join_url')
      expect(src).toContain('duration_minutes')
      expect(src).toContain('address')
    }
  })

  it('and the same instruction, so a caller and a texter are told the same thing', () => {
    const sentence = 'BOOK ANYWAY with address left out'
    expect(textTool).toContain(sentence)
    expect(voiceTool).toContain(sentence)
  })

  it('nothing new is REQUIRED — a field the model cannot fill must not stop the call', () => {
    expect(textTool).toContain("required: ['date', 'time'],")
    expect(voiceTool).toContain("required: ['date', 'time', 'customer_name', 'customer_phone'],")
  })

  it('the kind is an enum, never free text', () => {
    // So the model cannot invent "in person" or "Teams" — a fifth value fails the column's CHECK and
    // loses the booking.
    expect(textTool).not.toMatch(/meeting_kind: \{ type: 'string' \}/)
  })

  it('and the model is told never to invent a link', () => {
    for (const src of [textTool, voiceTool]) {
      expect(src).toContain('Never invent, guess or construct a link')
    }
  })
})

describe('the route takes them, and none of them can fail a booking', () => {
  it('writes all four', () => {
    // The insert moved into the shared core when the owner route arrived — one insert, two policies.
    expect(core).toContain('meeting_kind: kind, address: input.address, join_url: input.joinUrl, duration_minutes: input.durationMinutes,')
  })

  it('an unrecognised kind falls back rather than 400ing', () => {
    expect(route).toContain("MEETING_KINDS.includes(kindIn) ? kindIn : 'on_site'")
    expect(core).toContain("export const MEETING_KINDS = ['on_site', 'at_business', 'zoom', 'google_meet', 'phone']")
  })

  it('a join_url that is not a link is dropped, not stored', () => {
    expect(route).toMatch(/\/\^https\?:\\\/\\\/\\S\+\$\/i\.test\(joinRaw\)/)
  })

  it('a duration outside sane bounds is dropped, so the rail falls back to the tenant default', () => {
    expect(route).toContain('durRaw >= 5 && durRaw <= 480 ? durRaw : null')
  })

  it('none of the four is validated in a way that returns an error', () => {
    // Every guard resolves to a value or to null. A 400 here would mean losing an appointment over a
    // field the agenda is perfectly happy to show as missing.
    const block = route.slice(route.indexOf('const kindIn'), route.indexOf('if (!leadToken'))
    expect(block).not.toContain('NextResponse.json')
    expect(block).not.toContain('return')
  })
})

describe('at_business — the customer comes to us', () => {
  const agenda = readFileSync(new URL('./agenda.ts', import.meta.url), 'utf8')

  it('is a fifth kind, not a flag on the tenant', () => {
    // It is a fact about THIS appointment: a jeweller does home valuations and an HVAC firm takes
    // shop drop-offs. A per-tenant "we travel / they come to us" is right on average and wrong
    // exactly when it matters.
    expect(agenda).toContain("export type MeetingKind = 'on_site' | 'at_business' | 'zoom' | 'google_meet' | 'phone'")
  })

  it('is NEVER missing anything', () => {
    // Before it existed these rows were on_site with no address and went amber forever — a screen
    // insisting something was absent when nothing was.
    expect(agenda).toContain("if (kind === 'at_business') return { where: ownAddress, missing: null }")
  })

  it('and stays quiet even when the tenant has no address of their own', () => {
    // An owner who has not filled in their address knows where their shop is. An amber row would be
    // telling them something they cannot act on from an appointment screen.
    const fn = agenda.slice(agenda.indexOf('function placeOf'), agenda.indexOf('export async function readAgenda'))
    expect(fn).toContain('missing: null }')
    expect(fn).not.toMatch(/at_business[\s\S]{0,120}missing: 'address'/)
  })

  it('reads the business address once, not per row', () => {
    expect(agenda).toContain('const ownAddress = businessAddress(')
    expect(agenda).toContain("select('timezone, default_appointment_minutes, address, city, state')")
  })

  it('the owner form offers it and asks for no place', () => {
    const form = readFileSync(new URL('../../app/(v2)/v2/appointments/new.tsx', import.meta.url), 'utf8')
    expect(form).toContain("{ k: 'at_business', label: 'At the shop' }")
    // The place field is for on_site only — at_business and phone both want nothing.
    expect(form).toContain("{kind !== 'phone' && kind !== 'at_business' && (")
  })

  it('an unrecognised kind still falls back to on_site rather than 400ing', () => {
    // Unchanged, and it matters more now: an older voice-server that has never heard of at_business
    // keeps booking exactly as it does today.
    const core = readFileSync(new URL('./create.ts', import.meta.url), 'utf8')
    expect(core).toContain("MEETING_KINDS.includes(input.meetingKind) ? input.meetingKind : 'on_site'")
  })
})
