// Date/time parsing for appointment booking. The AI (and forms) send free-form
// values like "tomorrow", "Monday", "June 15", "9:00 AM" — normalize them.

const DEFAULT_TZ = 'America/New_York'
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

// Returns Y/M/D for "now" in the business timezone.
function todayParts(tz = DEFAULT_TZ): { y: number; m: number; d: number } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  const [y, m, d] = f.format(new Date()).split('-').map(Number)
  return { y, m, d }
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function addDays(dateIso: string, days: number): string {
  const dt = new Date(`${dateIso}T12:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + days)
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

// Day of week (0=Sunday) for a YYYY-MM-DD date.
export function dayOfWeek(dateIso: string): number {
  return new Date(`${dateIso}T12:00:00Z`).getUTCDay()
}

// Parse a free-form date into YYYY-MM-DD (or null if unrecognized).
export function parseDate(input: string, tz = DEFAULT_TZ): string | null {
  if (!input) return null
  const s = input.trim().toLowerCase()
  const t = todayParts(tz)
  const todayIso = iso(t.y, t.m, t.d)

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (s === 'today') return todayIso
  if (s === 'tomorrow') return addDays(todayIso, 1)
  if (s === 'day after tomorrow') return addDays(todayIso, 2)

  // Weekday name → next occurrence (today counts if it matches).
  const wd = WEEKDAYS.findIndex((w) => s === w || s === w.slice(0, 3) || s === `next ${w}`)
  if (wd >= 0) {
    const cur = dayOfWeek(todayIso)
    let delta = (wd - cur + 7) % 7
    if (s.startsWith('next ') && delta === 0) delta = 7
    return addDays(todayIso, delta)
  }

  // "Month Day" / "Day Month" (e.g. "june 15", "15 june").
  const mMatch = s.match(/([a-z]+)\.?\s+(\d{1,2})|(\d{1,2})\s+([a-z]+)/)
  if (mMatch) {
    const monName = (mMatch[1] || mMatch[4] || '').slice(0, 3)
    const day = Number(mMatch[2] || mMatch[3])
    const mon = MONTHS.findIndex((m) => m.startsWith(monName))
    if (mon >= 0 && day >= 1 && day <= 31) {
      let year = t.y
      // If the month/day already passed this year, assume next year.
      const candidate = iso(year, mon + 1, day)
      if (candidate < todayIso) year += 1
      return iso(year, mon + 1, day)
    }
  }

  // MM/DD or MM/DD/YYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (slash) {
    const mon = Number(slash[1]), day = Number(slash[2])
    let year = slash[3] ? Number(slash[3]) : t.y
    if (year < 100) year += 2000
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      const candidate = iso(year, mon, day)
      if (!slash[3] && candidate < todayIso) year += 1
      return iso(year, mon, day)
    }
  }

  return null
}

// Parse a free-form time into "HH:MM:SS" (24h) or null.
export function parseTime(input: string): string | null {
  if (!input) return null
  const s = input.trim().toLowerCase().replace(/\./g, '')
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const ap = m[3]
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`
}

// "HH:MM[:SS]" → "9:00 AM"
export function formatTime12(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':')
  let h = Number(hStr)
  const m = mStr || '00'
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${m} ${ap}`
}
