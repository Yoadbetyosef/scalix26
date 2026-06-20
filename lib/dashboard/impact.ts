import { createAdminClient } from '@/lib/supabase/server'

// The ONE global, documented constant behind "Time Returned To You". Not per-vertical,
// not per-business — a single estimate of owner minutes saved per handled conversation.
export const AVG_MINUTES_PER_CONVERSATION = 5

type Conv = {
  id: string
  contact_id: string | null
  channel: string | null
  created_at: string
  human_takeover: boolean | null
  status: string | null
  ai_employee_id: string | null
}
type AgentHours = { business_hours: Record<string, string> | null; timezone: string | null }

export interface Metric { value: number; lifetime?: number; trendPct: number | null }
export interface AttentionItem { label: string; href: string }

export interface ImpactData {
  hasAnyData: boolean
  monthLabel: string
  trendsAvailable: boolean // previous calendar month had inbound conversations
  customersHelped: Metric & { lifetime: number }
  opportunities: Metric & { lifetime: number }
  conversationsManaged: Metric
  timeReturnedHours: Metric // estimated
  responseTimeAvailable: false // not derivable from existing timestamps — empty-state
  coveragePct: { value: number | null; trendPct: number | null }
  report: string[]
  hero: string[]
  attention: AttentionItem[]
}

// Is a conversation's start outside the agent's business hours? null = can't tell.
function isAfterHours(createdAtIso: string, hours: AgentHours | undefined): boolean | null {
  const bh = hours?.business_hours
  if (!bh) return null
  const tz = hours?.timezone || 'America/New_York'
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(createdAtIso))
  const wd = (parts.find((p) => p.type === 'weekday')?.value || '').toLowerCase().slice(0, 3)
  let hh = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10) % 24
  const mm = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10)
  const spec = bh[wd]
  if (!spec || spec.trim().toLowerCase() === 'closed') return true
  const [open, close] = spec.split('-')
  const toMin = (t: string) => { const [h, m] = t.split(':'); return parseInt(h, 10) * 60 + parseInt(m || '0', 10) }
  const cur = hh * 60 + mm
  return cur < toMin(open) || cur >= toMin(close)
}

function pct(curr: number, prev: number): number | null {
  if (prev <= 0) return null
  return Math.round(((curr - prev) / prev) * 100)
}

export async function getImpactData(tenantId: string): Promise<ImpactData> {
  const supabase = createAdminClient()
  const now = new Date()
  const y = now.getUTCFullYear(), m = now.getUTCMonth()
  const monthStart = Date.UTC(y, m, 1)
  const nextStart = Date.UTC(y, m + 1, 1)
  const prevStart = Date.UTC(y, m - 1, 1)
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(now)

  const [{ data: convRows }, { data: agentRows }, { data: outRows }, { data: leadRows }, { count: undelivered }] = await Promise.all([
    supabase.from('conversations').select('id, contact_id, channel, created_at, human_takeover, status, ai_employee_id').eq('tenant_id', tenantId),
    supabase.from('ai_employees').select('id, business_hours, timezone').eq('tenant_id', tenantId),
    // Narrow projection: which conversations got a Scalix outbound, and when.
    supabase.from('messages').select('conversation_id, timestamp').eq('tenant_id', tenantId).in('role', ['assistant', 'agent']),
    supabase.from('leads').select('id, responded_at').eq('tenant_id', tenantId),
    supabase.from('messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('delivery_status', ['undelivered', 'failed']),
  ])

  const convs = (convRows || []) as Conv[]
  const hoursByAgent = new Map<string, AgentHours>()
  for (const a of agentRows || []) hoursByAgent.set(a.id, { business_hours: a.business_hours as Record<string, string> | null, timezone: a.timezone })
  const primaryHours = (agentRows || [])[0] ? { business_hours: agentRows![0].business_hours as Record<string, string> | null, timezone: agentRows![0].timezone } : undefined
  const hoursFor = (c: Conv): AgentHours | undefined => (c.ai_employee_id && hoursByAgent.get(c.ai_employee_id)) || primaryHours

  const convById = new Map(convs.map((c) => [c.id, c]))
  const respondedEver = new Set<string>()
  const respondedInWindow = (start: number, end: number) => {
    const s = new Set<string>()
    for (const o of outRows || []) {
      if (!o.conversation_id) continue
      const t = +new Date(o.timestamp)
      if (t >= start && t < end) s.add(o.conversation_id)
    }
    return s
  }
  for (const o of outRows || []) if (o.conversation_id) respondedEver.add(o.conversation_id)

  // Per-window aggregation. "inbound" = conversations CREATED in the window.
  const windowStats = (start: number, end: number) => {
    const inWin = convs.filter((c) => { const t = +new Date(c.created_at); return t >= start && t < end })
    const total = inWin.length
    const responded = inWin.filter((c) => respondedEver.has(c.id)).length
    let afterHours = 0, opportunities = 0
    for (const c of inWin) {
      const ah = isAfterHours(c.created_at, hoursFor(c))
      if (ah === true) afterHours++
      if (ah === true || c.human_takeover === true) opportunities++
    }
    // Customers helped = distinct customers who received a RESPONSE in the window.
    const respConv = respondedInWindow(start, end)
    const customers = new Set(
      [...respConv].map((id) => convById.get(id)?.contact_id).filter((x): x is string => !!x),
    ).size
    return { total, responded, afterHours, opportunities, customers, coverage: total > 0 ? Math.round((responded / total) * 100) : null }
  }

  const cur = windowStats(monthStart, nextStart)
  const prev = windowStats(prevStart, monthStart)
  const trendsAvailable = prev.total > 0

  // Lifetime
  const customersLifetime = new Set(convs.filter((c) => respondedEver.has(c.id)).map((c) => c.contact_id).filter((x): x is string => !!x)).size
  let oppLifetime = 0
  for (const c of convs) { const ah = isAfterHours(c.created_at, hoursFor(c)); if (ah === true || c.human_takeover === true) oppLifetime++ }

  const timeReturnedHours = Math.round((cur.total * AVG_MINUTES_PER_CONVERSATION) / 60 * 10) / 10
  const prevTimeReturned = (prev.total * AVG_MINUTES_PER_CONVERSATION) / 60

  // ── Hero sentences (real numbers only; skip empties) ───────────────────────
  const hero: string[] = []
  if (cur.opportunities > 0) hero.push(`Scalix protected ${cur.opportunities} ${cur.opportunities === 1 ? 'opportunity' : 'opportunities'} while your business was unavailable.`)
  if (cur.coverage !== null && cur.total > 0) hero.push(`Scalix stayed responsive to ${cur.coverage}% of the customers who reached out this month.`)
  if (cur.customers > 0) hero.push(`${cur.customers} ${cur.customers === 1 ? 'customer' : 'customers'} received a response from Scalix this month.`)
  if (cur.total > 0) hero.push(`Scalix handled ${cur.total} ${cur.total === 1 ? 'conversation' : 'conversations'} across your channels this month.`)

  // ── "What Scalix Did For You" report (human sentences; non-zero only) ───────
  const report: string[] = []
  if (cur.responded > 0) report.push(`Scalix responded to ${cur.responded} customer ${cur.responded === 1 ? 'conversation' : 'conversations'}.`)
  if (cur.customers > 0) report.push(`${cur.customers} different ${cur.customers === 1 ? 'customer' : 'customers'} received a response.`)
  if (cur.afterHours > 0) report.push(`${cur.afterHours} ${cur.afterHours === 1 ? 'customer' : 'customers'} reached you outside business hours.`)
  if (cur.opportunities > 0) report.push(`${cur.opportunities} ${cur.opportunities === 1 ? 'opportunity was' : 'opportunities were'} captured while you were unavailable.`)
  if (cur.coverage !== null && cur.total > 0) report.push(`Scalix kept your business responsive ${cur.coverage}% of the time customers reached out.`)

  // ── Attention Needed (real, actionable states only) ────────────────────────
  const attention: AttentionItem[] = []
  const takenOver = convs.filter((c) => c.human_takeover === true && c.status === 'open').length
  if (takenOver > 0) attention.push({ label: `${takenOver} ${takenOver === 1 ? 'conversation' : 'conversations'} you're handling personally`, href: '/inbox' })
  const leadsNoFollowup = (leadRows || []).filter((l) => !l.responded_at).length
  if (leadsNoFollowup > 0) attention.push({ label: `${leadsNoFollowup} ${leadsNoFollowup === 1 ? 'lead' : 'leads'} awaiting follow-up`, href: '/dashboard?tab=leads' })
  if ((undelivered || 0) > 0) attention.push({ label: `${undelivered} ${undelivered === 1 ? 'message' : 'messages'} didn't reach customers`, href: '/inbox' })

  return {
    hasAnyData: convs.length > 0 || (outRows || []).length > 0,
    monthLabel,
    trendsAvailable,
    customersHelped: { value: cur.customers, lifetime: customersLifetime, trendPct: trendsAvailable ? pct(cur.customers, prev.customers) : null },
    opportunities: { value: cur.opportunities, lifetime: oppLifetime, trendPct: trendsAvailable ? pct(cur.opportunities, prev.opportunities) : null },
    conversationsManaged: { value: cur.total, trendPct: trendsAvailable ? pct(cur.total, prev.total) : null },
    timeReturnedHours: { value: timeReturnedHours, trendPct: trendsAvailable ? pct(cur.total * AVG_MINUTES_PER_CONVERSATION, prevTimeReturned * 60) : null },
    responseTimeAvailable: false,
    coveragePct: { value: cur.coverage, trendPct: trendsAvailable && prev.coverage !== null && cur.coverage !== null ? cur.coverage - prev.coverage : null },
    report,
    hero,
    attention,
  }
}
