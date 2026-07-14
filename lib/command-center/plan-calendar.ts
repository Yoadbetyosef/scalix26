// Business calendar for the Plan — timezone-aware, configurable working days. There is NO hardcoded weekly
// divisor: daily pace uses the ACTUAL remaining working days in the founder's operating timezone and week
// boundary. Pure + tested. (weekStartDay: 0=Sun..6=Sat, default 1=Mon. workingDaysPerWeek: 1..7, default 7.)

export interface WorkCalendar { timezone: string; weekStartDay: number; workingDaysPerWeek: number }
export const DEFAULT_CALENDAR: WorkCalendar = { timezone: 'America/New_York', weekStartDay: 1, workingDaysPerWeek: 7 }

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

// Local calendar parts (year, 1-based month, day, day-of-week) in a timezone, from an epoch ms.
export function localParts(nowMs: number, tz: string): { y: number; m: number; d: number; dow: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour12: false }).formatToParts(new Date(nowMs))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), dow: DOW[get('weekday')] ?? 0 }
}

// Is a given day-of-week a working day? Working days are the first `workingDaysPerWeek` days of the operating
// week (starting at weekStartDay). e.g. Mon-start, 5 days → Mon-Fri; 7 days → every day.
export function isWorkingDayOfWeek(dow: number, cal: WorkCalendar): boolean {
  const pos = (dow - cal.weekStartDay + 7) % 7
  return pos < cal.workingDaysPerWeek
}

export function daysInMonthLocal(nowMs: number, tz: string): number {
  const { y, m } = localParts(nowMs, tz)
  return new Date(Date.UTC(y, m, 0)).getUTCDate() // day 0 of month index m (0-based) = last day of current month
}

// Remaining working days THIS WEEK, inclusive of today. 0 if today is past the working stretch (a rest day).
export function remainingWorkingDaysThisWeek(nowMs: number, cal: WorkCalendar): number {
  const { dow } = localParts(nowMs, cal.timezone)
  const pos = (dow - cal.weekStartDay + 7) % 7
  return pos < cal.workingDaysPerWeek ? cal.workingDaysPerWeek - pos : 0
}

// Working days THIS MONTH: total, elapsed (before today), remaining (today..end inclusive).
export function monthWorkingDays(nowMs: number, cal: WorkCalendar): { total: number; elapsed: number; remaining: number } {
  const { d, dow } = localParts(nowMs, cal.timezone)
  const dim = daysInMonthLocal(nowMs, cal.timezone)
  const dow1 = (dow - (d - 1) % 7 + 7 * 7) % 7 // day-of-week of the 1st of the month
  let total = 0, remaining = 0
  for (let day = 1; day <= dim; day++) {
    const wd = (dow1 + (day - 1)) % 7
    if (isWorkingDayOfWeek(wd, cal)) { total++; if (day >= d) remaining++ }
  }
  return { total, elapsed: total - remaining, remaining }
}

// Working days between today (inclusive) and a target date (inclusive), in the operating calendar.
export function workingDaysUntil(nowMs: number, targetDateIso: string, cal: WorkCalendar): number {
  const start = localParts(nowMs, cal.timezone)
  const startUTC = Date.UTC(start.y, start.m - 1, start.d)
  const t = new Date(targetDateIso + 'T00:00:00Z').getTime()
  if (t < startUTC) return 0
  const days = Math.round((t - startUTC) / 86_400_000)
  let count = 0
  for (let k = 0; k <= days; k++) if (isWorkingDayOfWeek((start.dow + k) % 7, cal)) count++
  return count
}
