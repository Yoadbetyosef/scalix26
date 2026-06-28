// Time-range parsing shared by every analytical source, so Amy supports today /
// yesterday / this week / last week / this/last month / this year / custom uniformly.
export function parseRange(input?: string, from?: string, to?: string): { start?: string; end?: string; label: string } {
  const p = (input || 'last_30_days').toLowerCase().replace(/[\s-]+/g, '_')
  const now = new Date()
  const iso = (d: Date) => d.toISOString()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dowMon = (dayStart.getDay() + 6) % 7 // 0 = Monday
  const ymd = (y: number, m: number, d: number) => new Date(y, m, d)

  switch (p) {
    case 'today': return { start: iso(dayStart), label: 'today' }
    case 'yesterday': { const s = new Date(dayStart); s.setDate(s.getDate() - 1); return { start: iso(s), end: iso(dayStart), label: 'yesterday' } }
    case 'this_week': { const s = new Date(dayStart); s.setDate(s.getDate() - dowMon); return { start: iso(s), label: 'this week' } }
    case 'last_week': { const s = new Date(dayStart); s.setDate(s.getDate() - dowMon - 7); const e = new Date(s); e.setDate(e.getDate() + 7); return { start: iso(s), end: iso(e), label: 'last week' } }
    case 'this_month': return { start: iso(ymd(now.getFullYear(), now.getMonth(), 1)), label: 'this month' }
    case 'last_month': { const s = ymd(now.getFullYear(), now.getMonth() - 1, 1); const e = ymd(now.getFullYear(), now.getMonth(), 1); return { start: iso(s), end: iso(e), label: 'last month' } }
    case 'this_year': return { start: iso(ymd(now.getFullYear(), 0, 1)), label: 'this year' }
    case 'last_year': { const s = ymd(now.getFullYear() - 1, 0, 1); const e = ymd(now.getFullYear(), 0, 1); return { start: iso(s), end: iso(e), label: 'last year' } }
    case 'last_7_days': { const s = new Date(now); s.setDate(s.getDate() - 7); return { start: iso(s), label: 'last 7 days' } }
    case 'last_30_days': { const s = new Date(now); s.setDate(s.getDate() - 30); return { start: iso(s), label: 'last 30 days' } }
    case 'last_90_days': { const s = new Date(now); s.setDate(s.getDate() - 90); return { start: iso(s), label: 'last 90 days' } }
    case 'all': return { label: 'all time' }
    case 'custom': return { start: from || undefined, end: to || undefined, label: `${from || 'start'} → ${to || 'now'}` }
    default: { const s = new Date(now); s.setDate(s.getDate() - 30); return { start: iso(s), label: 'last 30 days' } }
  }
}
