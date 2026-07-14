import { describe, it, expect } from 'vitest'
import { localParts, isWorkingDayOfWeek, remainingWorkingDaysThisWeek, monthWorkingDays, daysInMonthLocal, type WorkCalendar } from './plan-calendar'

// 2026-07-15 16:00Z = 12:00 EDT in New York → Wed July 15 (dow 3), day 15 of a 31-day month.
const NOW = Date.parse('2026-07-15T16:00:00.000Z')
const NY = 'America/New_York'
const cal = (workingDaysPerWeek: number, weekStartDay = 1): WorkCalendar => ({ timezone: NY, weekStartDay, workingDaysPerWeek })

describe('Business calendar (timezone-aware, configurable working days)', () => {
  it('reads local date parts in America/New_York (not server UTC)', () => {
    const p = localParts(NOW, NY)
    expect(p).toMatchObject({ y: 2026, m: 7, d: 15, dow: 3 }) // Wednesday
    // Late UTC evening is still the same NY day, and near midnight UTC rolls back a day in NY.
    expect(localParts(Date.parse('2026-07-16T03:00:00Z'), NY).d).toBe(15) // 11pm EDT July 15
    expect(daysInMonthLocal(NOW, NY)).toBe(31)
  })

  it('Monday–Sunday boundary: working days are the first N of the operating week', () => {
    // Mon-start, 5 working days → Mon-Fri work, Sat/Sun rest.
    expect(isWorkingDayOfWeek(1, cal(5))).toBe(true)  // Mon
    expect(isWorkingDayOfWeek(5, cal(5))).toBe(true)  // Fri
    expect(isWorkingDayOfWeek(6, cal(5))).toBe(false) // Sat
    expect(isWorkingDayOfWeek(0, cal(5))).toBe(false) // Sun
    // 7-day week → every day works.
    expect([0, 1, 2, 3, 4, 5, 6].every((d) => isWorkingDayOfWeek(d, cal(7)))).toBe(true)
  })

  it('remaining working days THIS WEEK depend on the working-days setting (no fixed divisor)', () => {
    expect(remainingWorkingDaysThisWeek(NOW, cal(7))).toBe(5) // Wed..Sun
    expect(remainingWorkingDaysThisWeek(NOW, cal(5))).toBe(3) // Wed..Fri
    expect(remainingWorkingDaysThisWeek(NOW, cal(1))).toBe(0) // only Mon works; Wed is a rest day
  })

  it('working days THIS MONTH: total / elapsed / remaining', () => {
    const m7 = monthWorkingDays(NOW, cal(7))
    expect(m7).toEqual({ total: 31, elapsed: 14, remaining: 17 }) // day 15 → 17 remaining inclusive
    const m5 = monthWorkingDays(NOW, cal(5))
    expect(m5.total).toBe(23) // 23 weekdays in July 2026
    expect(m5.elapsed + m5.remaining).toBe(m5.total)
  })
})
