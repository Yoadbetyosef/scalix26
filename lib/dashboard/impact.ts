import { createAdminClient } from '@/lib/supabase/server'
import { isNonCustomerEmail, domainsFromEmails } from '@/lib/email/is-non-customer'

// ── Types ────────────────────────────────────────────────────────────────────
export type Conv = {
  id: string
  contact_id: string | null
  channel: string | null
  created_at: string
  human_takeover: boolean | null
  status: string | null
  ai_employee_id: string | null
}
type AgentHours = { business_hours: Record<string, string> | null; timezone: string | null }
export type LeadRow = { id: string; contact_id: string | null; name: string | null; phone: string | null; created_at: string; responded_at: string | null }

// SMS delivery failures from A2P/10DLC carrier REGISTRATION are platform-side and not
// customer-fixable — excluded everywhere customer-facing (cards + attention + drill-down).
const PLATFORM_DELIVERY_ERROR_CODES = new Set(['30034', '30033', '30032', '30031', '30030', '30024', '30007', '30005', '30006'])

const CHANNEL_LABELS: { channel: string; label: string }[] = [
  { channel: 'sms', label: 'by text' },
  { channel: 'voice', label: 'by phone' },
  { channel: 'instagram', label: 'via Instagram' },
  { channel: 'facebook', label: 'via Facebook' },
  { channel: 'whatsapp', label: 'via WhatsApp' },
  { channel: 'email', label: 'by email' },
]

export interface Metric { value: number }
export interface AttentionItem { label: string; href: string; metric?: DrilldownMetric }
export interface ChannelStat { channel: string; label: string; count: number }
export type DrilldownMetric = 'customers_assisted' | 'opportunities' | 'conversations_managed' | 'coverage' | 'attention_takeover' | 'attention_leads'

export interface ImpactData {
  monthLabel: string
  customersHelped: Metric
  opportunities: Metric
  conversationsManaged: Metric
  coveragePct: { value: number | null; responded: number; total: number }
  channelBreakdown: ChannelStat[]
  attention: AttentionItem[]
}

// ── Shared base (one load) ───────────────────────────────────────────────────
export interface ImpactBase {
  convs: Conv[]
  convById: Map<string, Conv>
  hoursFor: (c: Conv) => AgentHours | undefined
  respondedEver: Set<string>
  outByConv: Map<string, number[]> // conv_id -> outbound message timestamps (ms)
  leads: LeadRow[]
  failedErrorCodes: (string | null)[]
}

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
  const toMin = (t: string) => { const [h, mn] = t.split(':'); return parseInt(h, 10) * 60 + parseInt(mn || '0', 10) }
  const cur = hh * 60 + mm
  return cur < toMin(open) || cur >= toMin(close)
}

export async function loadImpactBase(tenantId: string): Promise<ImpactBase> {
  const supabase = createAdminClient()
  const [{ data: convRows }, { data: agentRows }, { data: outRows }, { data: leadRows }, { data: failedRows }, { data: contactRows }, { data: acctRows }] = await Promise.all([
    supabase.from('conversations').select('id, contact_id, channel, created_at, human_takeover, status, ai_employee_id').eq('tenant_id', tenantId),
    supabase.from('ai_employees').select('id, business_hours, timezone').eq('tenant_id', tenantId),
    supabase.from('messages').select('conversation_id, timestamp').eq('tenant_id', tenantId).in('role', ['assistant', 'agent']),
    supabase.from('leads').select('id, contact_id, name, phone, created_at, responded_at').eq('tenant_id', tenantId),
    supabase.from('messages').select('error_code').eq('tenant_id', tenantId).in('delivery_status', ['undelivered', 'failed']),
    supabase.from('contacts').select('id, email').eq('tenant_id', tenantId),
    supabase.from('connected_email_accounts').select('email_address').eq('tenant_id', tenantId),
  ])

  // EMAIL-ONLY data-quality gate: exclude non-customer email senders (automated /
  // notification / platform / self / the tenant's OWN domain) from the dashboard — both
  // metrics and drill-down, since they share base.convs (so count === records stays
  // exact). SMS/voice are never filtered. Uncertain senders are kept (fail-safe).
  const emailByContact = new Map((contactRows || []).map((c) => [c.id, c.email as string | null]))
  const tenantDomains = domainsFromEmails((acctRows || []).map((a) => a.email_address))
  const convs = ((convRows || []) as Conv[]).filter((c) => {
    if (c.channel !== 'email') return true
    const email = c.contact_id ? emailByContact.get(c.contact_id) : null
    return !isNonCustomerEmail(email, tenantDomains).blocked
  })
  const hoursByAgent = new Map<string, AgentHours>()
  for (const a of agentRows || []) hoursByAgent.set(a.id, { business_hours: a.business_hours as Record<string, string> | null, timezone: a.timezone })
  const primaryHours = (agentRows || [])[0] ? { business_hours: agentRows![0].business_hours as Record<string, string> | null, timezone: agentRows![0].timezone } : undefined
  const hoursFor = (c: Conv): AgentHours | undefined => (c.ai_employee_id && hoursByAgent.get(c.ai_employee_id)) || primaryHours

  const convById = new Map(convs.map((c) => [c.id, c]))
  const respondedEver = new Set<string>()
  const outByConv = new Map<string, number[]>()
  for (const o of outRows || []) {
    if (!o.conversation_id) continue
    respondedEver.add(o.conversation_id)
    const arr = outByConv.get(o.conversation_id) || []
    arr.push(+new Date(o.timestamp))
    outByConv.set(o.conversation_id, arr)
  }

  return {
    convs, convById, hoursFor, respondedEver, outByConv,
    leads: (leadRows || []) as LeadRow[],
    failedErrorCodes: (failedRows || []).map((r) => (r.error_code === null ? null : String(r.error_code))),
  }
}

// ── Window helpers ───────────────────────────────────────────────────────────
export function currentMonthWindow() {
  const now = new Date()
  const y = now.getUTCFullYear(), m = now.getUTCMonth()
  return {
    start: Date.UTC(y, m, 1),
    end: Date.UTC(y, m + 1, 1),
    label: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(now),
  }
}

const byNewest = (a: Conv, b: Conv) => +new Date(b.created_at) - +new Date(a.created_at)

// ── SHARED SELECTORS — the single source of truth for both count and records ──
// Each card's number is `selectX(...).length`; each drill-down returns `selectX(...)`.
function inWindow(base: ImpactBase, start: number, end: number): Conv[] {
  return base.convs.filter((c) => { const t = +new Date(c.created_at); return t >= start && t < end })
}
function respondedInWindowSet(base: ImpactBase, start: number, end: number): Set<string> {
  const s = new Set<string>()
  for (const [cid, ts] of base.outByConv) if (ts.some((t) => t >= start && t < end)) s.add(cid)
  return s
}
export function isOpportunity(base: ImpactBase, c: Conv): boolean {
  const ah = isAfterHours(c.created_at, base.hoursFor(c))
  return ah === true || c.human_takeover === true
}
// Did this conversation start outside the agent's business hours? (structured;
// reuses the same business-hours logic the metrics use). Used for outcome tags.
export function afterHoursForConv(base: ImpactBase, c: Conv): boolean {
  return isAfterHours(c.created_at, base.hoursFor(c)) === true
}

export function selectConversationsManaged(base: ImpactBase, start: number, end: number): Conv[] {
  return inWindow(base, start, end).sort(byNewest)
}
export function selectOpportunities(base: ImpactBase, start: number, end: number): Conv[] {
  return inWindow(base, start, end).filter((c) => isOpportunity(base, c)).sort(byNewest)
}
// Distinct customers who received a response in the window → one row per contact
// (their most-recent responded conversation). length === distinct customers.
export function selectCustomersAssisted(base: ImpactBase, start: number, end: number): Conv[] {
  const responded = respondedInWindowSet(base, start, end)
  const byContact = new Map<string, Conv>()
  for (const id of responded) {
    const c = base.convById.get(id)
    if (!c?.contact_id) continue
    const ex = byContact.get(c.contact_id)
    if (!ex || +new Date(c.created_at) > +new Date(ex.created_at)) byContact.set(c.contact_id, c)
  }
  return [...byContact.values()].sort(byNewest)
}
// All inbound conversations this window (denominator of coverage) + which responded.
export function selectCoverageInbound(base: ImpactBase, start: number, end: number): { rows: Conv[]; respondedSet: Set<string> } {
  return { rows: inWindow(base, start, end).sort(byNewest), respondedSet: base.respondedEver }
}
export function selectTakeoverOpen(base: ImpactBase): Conv[] {
  return base.convs.filter((c) => c.human_takeover === true && c.status === 'open').sort(byNewest)
}
export function selectLeadsNoFollowup(base: ImpactBase): LeadRow[] {
  return base.leads.filter((l) => !l.responded_at).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
}

// ── ATTENTION: the single definition of what "needs attention" (customer-actionable). ────────
// One place computes the items; every surface (dashboard header, voice assistant, notification
// bell, Attention Needed section) consumes them through the client attention store. A2P carrier
// delivery failures are excluded (platform-side, not customer-fixable).
export function computeAttention(base: ImpactBase): AttentionItem[] {
  const attention: AttentionItem[] = []
  const takeover = selectTakeoverOpen(base)
  if (takeover.length > 0) attention.push({ label: `${takeover.length} ${takeover.length === 1 ? 'conversation' : 'conversations'} you're handling personally`, href: '/inbox', metric: 'attention_takeover' })
  const leadsNo = selectLeadsNoFollowup(base)
  // The item survives the Leads tab, because the work does: these are people who reached out and
  // have not been answered. On the dashboard it opens the proof drawer via `metric`; `href` is the
  // fallback the notification bell follows, and it now points at contacts rather than a dead tab.
  if (leadsNo.length > 0) attention.push({ label: `${leadsNo.length} ${leadsNo.length === 1 ? 'lead' : 'leads'} awaiting follow-up`, href: '/contacts', metric: 'attention_leads' })
  const fixableFailures = base.failedErrorCodes.filter((c) => !c || !PLATFORM_DELIVERY_ERROR_CODES.has(c)).length
  if (fixableFailures > 0) attention.push({ label: `${fixableFailures} ${fixableFailures === 1 ? 'message' : 'messages'} didn't reach customers`, href: '/inbox' })
  return attention
}

/** Light path for the client store / notification bell: just the attention items (no metrics recompute). */
export async function getAttention(tenantId: string): Promise<AttentionItem[]> {
  return computeAttention(await loadImpactBase(tenantId))
}

// ── Card data (counts derived from the SAME selectors used by drill-down) ─────
export async function getImpactData(tenantId: string): Promise<ImpactData> {
  const base = await loadImpactBase(tenantId)
  const { start, end, label } = currentMonthWindow()

  const curManaged = selectConversationsManaged(base, start, end)
  const curOpp = selectOpportunities(base, start, end)
  const curCust = selectCustomersAssisted(base, start, end)
  const cov = selectCoverageInbound(base, start, end)
  const responded = cov.rows.filter((r) => cov.respondedSet.has(r.id)).length
  const total = cov.rows.length
  const coverage = total > 0 ? Math.round((responded / total) * 100) : null

  // NO PREVIOUS-MONTH OR LIFETIME PASS ANY MORE. The four "vs last month" trends and the two
  // "since you started" totals were read by the impact metric cards, which the hero's right column
  // replaced. Six full re-selections over every conversation the tenant has ever had, computed on
  // every dashboard render for two lines of small print nobody reads any more.
  //
  // Worth being exact about what this does and does not save: the seven Supabase queries in
  // loadImpactBase are unchanged, because they were never per-window — they pull the tenant's
  // conversations, messages and leads once and every figure is sliced from that in memory. So no
  // query was dropped here; six O(conversations) passes were.

  // Per-channel recap: responded conversations this window grouped by channel.
  const counts = new Map<string, number>()
  for (const c of curManaged) if (base.respondedEver.has(c.id) && c.channel) counts.set(c.channel, (counts.get(c.channel) || 0) + 1)
  const channelBreakdown = CHANNEL_LABELS.map(({ channel, label: l }) => ({ channel, label: l, count: counts.get(channel) || 0 })).filter((c) => c.count > 0)

  const attention = computeAttention(base)

  return {
    monthLabel: label,
    customersHelped: { value: curCust.length },
    opportunities: { value: curOpp.length },
    conversationsManaged: { value: curManaged.length },
    coveragePct: { value: coverage, responded, total },
    channelBreakdown,
    attention,
  }
}
