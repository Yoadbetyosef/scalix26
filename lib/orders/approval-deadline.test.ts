import { describe, expect, it } from 'vitest'
import { endOfDayUtc } from './approval-deadline'

// The bug this file is about, stated as arithmetic:
//
//   new Date('2026-09-08' + 'T23:59:59Z')  →  2026-09-08T23:59:59Z  →  16:59:59 in Vancouver
//
// She sent the link at 18:26 local. That is the whole fault, and the first test is it.

describe('endOfDayUtc', () => {
  it('ends the day at midnight LOCAL, not at midnight UTC', () => {
    // Vancouver is UTC-7 in September (PDT), so the end of the 8th is 06:59:59Z on the 9th.
    expect(endOfDayUtc('2026-09-08', 'America/Vancouver')).toBe('2026-09-09T06:59:59.000Z')
  })

  it('is AFTER the moment her two links were actually sent', () => {
    // The regression, as the data records it. Both rows: sent_at 2026-09-09T01:2x:00Z, expires_at
    // 2026-09-08T23:59:59Z. Under the old arithmetic the deadline preceded the send by 87 minutes.
    const sentAt = Date.parse('2026-09-09T01:27:16.875Z')
    const old = Date.parse('2026-09-08T23:59:59Z')
    expect(old).toBeLessThan(sentAt)

    const fixed = Date.parse(endOfDayUtc('2026-09-08', 'America/Vancouver')!)
    expect(fixed).toBeGreaterThan(sentAt)
  })

  it('handles the tenant timezone actually stored on her row', () => {
    // TG jewellers is recorded as America/New_York, which is wrong by three hours — she is in
    // Vancouver — but it is what the resolver will return until somebody corrects the setting. Even
    // wrong, it is four hours better than UTC, and today's links would have survived it.
    const fixed = Date.parse(endOfDayUtc('2026-09-08', 'America/New_York')!)
    expect(fixed).toBeGreaterThan(Date.parse('2026-09-09T01:27:16.875Z'))
  })

  it('is exact east of Greenwich too', () => {
    // Sydney is UTC+10 in July (no DST in winter), so the local day ends the PREVIOUS day in UTC.
    expect(endOfDayUtc('2026-07-15', 'Australia/Sydney')).toBe('2026-07-15T13:59:59.000Z')
  })

  it('is exact in a half-hour zone', () => {
    // Kolkata is UTC+5:30 year round. A fixed hour table gets this wrong; Intl does not.
    expect(endOfDayUtc('2026-07-15', 'Asia/Kolkata')).toBe('2026-07-15T18:29:59.000Z')
  })

  it('lands on the right side of a spring-forward boundary', () => {
    // US DST began 8 March 2026. The 8th is a 23-hour day in New York; its end is still 03:59:59Z
    // on the 9th because the clocks moved at 02:00, long before the end of the day.
    expect(endOfDayUtc('2026-03-08', 'America/New_York')).toBe('2026-03-09T03:59:59.000Z')
    // The day BEFORE the change is still on standard time: 04:59:59Z.
    expect(endOfDayUtc('2026-03-07', 'America/New_York')).toBe('2026-03-08T04:59:59.000Z')
  })

  it('lands on the right side of a fall-back boundary', () => {
    // US DST ended 1 November 2026 — a 25-hour day, and the end of it is on standard time.
    expect(endOfDayUtc('2026-11-01', 'America/New_York')).toBe('2026-11-02T04:59:59.000Z')
  })

  it('refuses a malformed date rather than guessing', () => {
    expect(endOfDayUtc('', 'America/Vancouver')).toBeNull()
    expect(endOfDayUtc('8 Sep 2026', 'America/Vancouver')).toBeNull()
    expect(endOfDayUtc('2026-9-8', 'America/Vancouver')).toBeNull()
  })

  it('refuses a date that is not a real day', () => {
    // Date.UTC rolls 31 February forward to 3 March without complaint. A deadline silently moved by
    // three days is worse than no deadline, so the round-trip guard rejects it.
    expect(endOfDayUtc('2026-02-31', 'America/Vancouver')).toBeNull()
    expect(endOfDayUtc('2026-13-01', 'America/Vancouver')).toBeNull()
  })

  it('refuses an unknown timezone instead of throwing', () => {
    // Intl throws on a bad zone. A thrown deadline must never take the whole send with it — the
    // approval is the thing that matters and it goes out with no deadline shown.
    expect(endOfDayUtc('2026-09-08', 'Mars/Olympus_Mons')).toBeNull()
    expect(endOfDayUtc('2026-09-08', '')).toBeNull()
  })
})
