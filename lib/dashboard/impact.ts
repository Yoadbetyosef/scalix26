import { createAdminClient } from '@/lib/supabase/server'

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

// SMS delivery failures caused by A2P/10DLC carrier REGISTRATION are a platform-side
// issue the customer cannot fix — they must NOT appear in the customer Attention list
// (only in an internal/admin view). Exclude these error codes from customer-facing
// delivery alerts. (30034 = US A2P 10DLC not registered, and the 3003x/3000x family.)
const PLATFORM_DELIVERY_ERROR_CODES = new Set([
  '30034', '30033', '30032', '30031', '30030', '30024', '30007', '30005', '30006',
])

export interface Metric { value: number; lifetime?: number; trendPct: number | null }
export interface AttentionItem { label: string; href: string }
export interface ChannelStat { channel: string; label: string; count: number }

export interface ImpactData {
  hasAnyData: boolean
  monthLabel: string
  trendsAvailable: boolean
  customersHelped: Metric & { lifetime: number }
  opportunities: Metric & { lifetime: number }
  conversationsManaged: Metric
  coveragePct: { value: number | null; trendPct: number | null }
  channelBreakdown: ChannelStat[] // responded conversations by channel this period; count>0 only
  humanTakeoverCount: number // conversations you stepped into this period
  attention: AttentionItem[]
  // SEAM: when per-message receive-vs-reply timestamps exist, add an
  // `instantResponse` metric here (currently NOT derivable — omitted, never faked).
}

// Channel → human label for the per-channel recap. Order defines display order.
const CHANNEL_LABELS: { channel: string; label: string }[] = [
  { channel: 'sms', label: 'by text' },
  { channel: 'voice', label: 'by phone' },
  { channel: 'instagram', label: 'via Instagram' },
  { channel: 'facebook', label: 'via Facebook' },
  { channel: 'whatsapp', label: 'via WhatsApp' },
  { channel: 'email', label: 'by email' },
]

// Is a conversation's start outside the agent's business hours? null = can't tell.
function isAfterHours(createdAtIso: string, hours: AgentHours | undefined): boolean | null {
  const bh = hours?.business_hours
  if (!bh) return null
  const tz = hours?.timezone || 'America/New_York'
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(createdAtIso))
  const wd = (parts.find((p) => p.type === 'weekday')?.value || '').toLowerCase().slice(0, 3)
  const hh = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10) % 24
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

  const [{ data: convRows }, { data: agentRows }, { data: outRows }, { data: leadRows }, { data: failedRows }] = await Promise.all([
    supabase.from('conversations').select('id, contact_id, channel, created_at, human_takeover, status, ai_employee_id').eq('tenant_id', tenantId),
    supabase.from('ai_employees').select('id, business_hours, timezone').eq('tenant_id', tenantId),
    supabase.from('messages').select('conversation_id, timestamp').eq('tenant_id', tenantId).in('role', ['assistant', 'agent']),
    supabase.from('leads').select('id, responded_at').eq('tenant_id', tenantId),
    // Delivery failures WITH their error code, so we can drop platform-side (A2P) ones.
    supabase.from('messages').select('error_code').eq('tenant_id', tenantId).in('delivery_status', ['undelivered', 'failed']),
  ])

  const convs = (convRows || []) as Conv[]
  const hoursByAgent = new Map<string, AgentHours>()
  for (const a of agentRows || []) hoursByAgent.set(a.id, { business_hours: a.business_hours as Record<string, string> | null, timezone: a.timezone })
  const primaryHours = (agentRows || [])[0] ? { business_hours: agentRows![0].business_hours as Record<string, string> | null, timezone: agentRows![0].timezone } : undefined
  const hoursFor = (c: Conv): AgentHours | undefined => (c.ai_employee_id && hoursByAgent.get(c.ai_employee_id)) || primaryHours

  const convById = new Map(convs.map((c) => [c.id, c]))
  const respondedEver = new Set<string>()
  for (const o of outRows || []) if (o.conversation_id) respondedEver.add(o.conversation_id)
  const respondedInWindow = (start: number, end: number) => {
    const s = new Set<string>()
    for (const o of outRows || []) { if (!o.conversation_id) continue; const t = +new Date(o.timestamp); if (t >= start && t < end) s.add(o.conversation_id) }
    return s
  }

  const windowStats = (start: number, end: number) => {
    const inWin = convs.filter((c) => { const t = +new Date(c.created_at); return t >= start && t < end })
    const total = inWin.length
    const responded = inWin.filter((c) => respondedEver.has(c.id)).length
    let afterHours = 0, opportunities = 0, takeover = 0
    for (const c of inWin) {
      const ah = isAfterHours(c.created_at, hoursFor(c))
      if (ah === true) afterHours++
      if (ah === true || c.human_takeover === true) opportunities++
      if (c.human_takeover === true) takeover++
    }
    const respConv = respondedInWindow(start, end)
    const customers = new Set([...respConv].map((id) => convById.get(id)?.contact_id).filter((x): x is string => !!x)).size
    return { inWin, total, responded, afterHours, opportunities, takeover, customers, coverage: total > 0 ? Math.round((responded / total) * 100) : null }
  }

  const cur = windowStats(monthStart, nextStart)
  const prev = windowStats(prevStart, monthStart)
  const trendsAvailable = prev.total > 0

  // Lifetime
  const customersLifetime = new Set(convs.filter((c) => respondedEver.has(c.id)).map((c) => c.contact_id).filter((x): x is string => !!x)).size
  let oppLifetime = 0
  for (const c of convs) { const ah = isAfterHours(c.created_at, hoursFor(c)); if (ah === true || c.human_takeover === true) oppLifetime++ }

  // Per-channel recap: responded conversations THIS period, grouped by channel (>0 only).
  const counts = new Map<string, number>()
  for (const c of cur.inWin) if (respondedEver.has(c.id) && c.channel) counts.set(c.channel, (counts.get(c.channel) || 0) + 1)
  const channelBreakdown: ChannelStat[] = CHANNEL_LABELS
    .map(({ channel, label }) => ({ channel, label, count: counts.get(channel) || 0 }))
    .filter((c) => c.count > 0)

  // ── Attention Needed (real, customer-ACTIONABLE only) ──────────────────────
  const attention: AttentionItem[] = []
  const takenOver = convs.filter((c) => c.human_takeover === true && c.status === 'open').length
  if (takenOver > 0) attention.push({ label: `${takenOver} ${takenOver === 1 ? 'conversation' : 'conversations'} you're handling personally`, href: '/inbox' })
  const leadsNoFollowup = (leadRows || []).filter((l) => !l.responded_at).length
  if (leadsNoFollowup > 0) attention.push({ label: `${leadsNoFollowup} ${leadsNoFollowup === 1 ? 'lead' : 'leads'} awaiting follow-up`, href: '/dashboard?tab=leads' })
  // Customer-fixable delivery failures only — A2P/carrier registration errors are excluded.
  const fixableFailures = (failedRows || []).filter((r) => !r.error_code || !PLATFORM_DELIVERY_ERROR_CODES.has(String(r.error_code))).length
  if (fixableFailures > 0) attention.push({ label: `${fixableFailures} ${fixableFailures === 1 ? 'message' : 'messages'} didn't reach customers`, href: '/inbox' })

  return {
    hasAnyData: convs.length > 0 || (outRows || []).length > 0,
    monthLabel,
    trendsAvailable,
    customersHelped: { value: cur.customers, lifetime: customersLifetime, trendPct: trendsAvailable ? pct(cur.customers, prev.customers) : null },
    opportunities: { value: cur.opportunities, lifetime: oppLifetime, trendPct: trendsAvailable ? pct(cur.opportunities, prev.opportunities) : null },
    conversationsManaged: { value: cur.total, trendPct: trendsAvailable ? pct(cur.total, prev.total) : null },
    coveragePct: { value: cur.coverage, trendPct: trendsAvailable && prev.coverage !== null && cur.coverage !== null ? cur.coverage - prev.coverage : null },
    channelBreakdown,
    humanTakeoverCount: cur.takeover,
    attention,
  }
}
