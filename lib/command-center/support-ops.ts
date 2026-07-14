import { type MetricValue, metric } from './sources'
import { demandHours as demandHoursOf, availableHours as availableHoursOf, utilization as utilOf, type SupportCapacityInputs } from './support'

// Operational Support Proxy — NOT a ticket system (there is none). Every signal here is derived from real
// operational metadata (conversation status/human-takeover, message delivery failures, channel health).
// NO message/conversation CONTENT is ever read or stored. Raw "open conversations" are a tenant end-customer
// PRODUCT-USAGE signal and are deliberately EXCLUDED from Scalix's actionable support demand. Pure + tested.

export const ISSUE_TYPES = ['onboarding', 'billing', 'phone', 'sms', 'whatsapp', 'facebook', 'instagram', 'gmail', 'calendar', 'ai_quality', 'voice_quality', 'booking', 'workflow', 'knowledge', 'integration', 'product_bug', 'training', 'provider_outage', 'unknown'] as const
export type IssueType = typeof ISSUE_TYPES[number]
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type Severity = typeof SEVERITIES[number]

// Derived operational signal — metadata only.
export type SignalKind = 'human_takeover' | 'open_conversation' | 'message_failure' | 'channel_down' | 'channel_unverified'
export interface SupportSignal {
  id: string; kind: SignalKind; tenantId: string
  channel: string | null; ageHours: number; createdAt: string; errorCode?: string | null
}
export interface AffectedTenant { name: string; plan: string; mrrCents: number; isTrial: boolean; healthBucket: string; lifecycle: string }
export interface SupportOverlay {
  signalId: string; owner: string | null; issueType: string | null; severity: Severity | null
  status: string | null; notes: string | null; resolutionNote: string | null; updatedBy: string | null; updatedAt: string | null
}
export const emptySupportOverlay = (signalId: string): SupportOverlay => ({ signalId, owner: null, issueType: null, severity: null, status: null, notes: null, resolutionNote: null, updatedBy: null, updatedAt: null })

// INCIDENT signals the support team must respond to. Raw open conversations (tenant end-customer volume) and
// channel_unverified (a routine A2P/provisioning backlog, not an incident) are deliberately excluded so
// "actionable demand" reflects real support incidents — provisioning is surfaced as its own backlog metric.
export const isActionable = (s: SupportSignal): boolean => s.kind === 'human_takeover' || s.kind === 'message_failure' || s.kind === 'channel_down'

const CHANNEL_ISSUE: Record<string, IssueType> = { voice: 'phone', sms: 'sms', whatsapp: 'whatsapp', email: 'gmail', gmail: 'gmail', instagram: 'instagram', facebook: 'facebook' }

export function deriveIssueType(s: SupportSignal): { issue: IssueType; derived: boolean } {
  if (s.kind === 'channel_down') return { issue: 'integration', derived: true }
  if (s.kind === 'channel_unverified') return { issue: s.channel === 'sms' ? 'sms' : 'phone', derived: true }
  if (s.kind === 'message_failure') return { issue: CHANNEL_ISSUE[s.channel ?? ''] ?? 'integration', derived: true }
  if (s.kind === 'human_takeover') return { issue: 'ai_quality', derived: true }
  const c = CHANNEL_ISSUE[s.channel ?? '']
  return c ? { issue: c, derived: true } : { issue: 'unknown', derived: false }
}

export function severityOf(s: SupportSignal, mrrCents: number): Severity {
  if (s.kind === 'channel_down' || s.kind === 'message_failure') return mrrCents > 0 ? 'high' : 'medium'
  if (s.kind === 'human_takeover') return mrrCents > 0 ? 'high' : 'medium'
  if (s.kind === 'channel_unverified') return 'medium'
  return 'low'
}

export interface SupportParams { avgHandlingMinutes: number; capacity: SupportCapacityInputs; nowMs: number; nowIso: string; slaHours: number }

export interface SupportOps {
  openConversationLoad: MetricValue // product-usage signal (tenant end-customer volume) — NOT support demand
  humanTakeoverLoad: MetricValue; messageFailureLoad: MetricValue; channelDownLoad: MetricValue; provisioningLoad: MetricValue
  actionableDemand: MetricValue
  newToday: MetricValue; new7d: MetricValue; new30d: MetricValue
  demandHours: MetricValue; availableHours: MetricValue; utilization: MetricValue
  slaAtRisk: MetricValue
  customersAffected: MetricValue; payingMrrAffectedCents: MetricValue; trialsAffected: MetricValue
  byChannel: Array<{ channel: string; count: number }>
  byIssue: Array<{ issue: IssueType; count: number; derivedShare: number }>
  freshnessAt: string
}

export function summarizeSupport(signals: SupportSignal[], tenants: Map<string, AffectedTenant>, p: SupportParams): SupportOps {
  const iso = p.nowIso
  const openConv = signals.filter((s) => s.kind === 'open_conversation').length
  const actionable = signals.filter(isActionable)
  const countKind = (k: SignalKind) => signals.filter((s) => s.kind === k).length
  const inWindow = (createdAt: string, ms: number) => p.nowMs - new Date(createdAt).getTime() <= ms
  const DAY = 86_400_000
  const dHours = demandHoursOf({ requests: actionable.length, avgHandlingMinutes: p.avgHandlingMinutes })
  const aHours = availableHoursOf(p.capacity)
  const affectedIds = new Set(actionable.map((s) => s.tenantId))
  let mrr = 0, trials = 0
  for (const id of affectedIds) { const t = tenants.get(id); if (!t) continue; if (t.isTrial) trials++; else mrr += t.mrrCents }
  const byChannelMap = new Map<string, number>()
  for (const s of actionable) { const c = s.channel ?? 'unknown'; byChannelMap.set(c, (byChannelMap.get(c) ?? 0) + 1) }
  const byIssueAgg = new Map<IssueType, { count: number; derived: number }>()
  for (const s of actionable) { const { issue, derived } = deriveIssueType(s); const e = byIssueAgg.get(issue) ?? { count: 0, derived: 0 }; e.count++; if (derived) e.derived++; byIssueAgg.set(issue, e) }
  const D = (v: number | null, caveat?: string) => metric(v, 'derived_actual', { coverage: 1, freshnessAt: iso, caveat })
  return {
    openConversationLoad: metric(openConv, 'derived_actual', { coverage: 1, freshnessAt: iso, caveat: 'Tenant end-customer conversation volume (product usage) — NOT Scalix support demand.' }),
    humanTakeoverLoad: D(countKind('human_takeover')),
    messageFailureLoad: D(countKind('message_failure')),
    channelDownLoad: D(countKind('channel_down')),
    provisioningLoad: metric(countKind('channel_unverified'), 'derived_actual', { coverage: 1, freshnessAt: iso, caveat: 'SMS numbers pending A2P verification — a provisioning backlog (onboarding), not a support incident.' }),
    actionableDemand: D(actionable.length, 'Support incidents: human takeovers + delivery/channel failures. Excludes raw open conversations (usage) and SMS provisioning backlog.'),
    newToday: D(actionable.filter((s) => inWindow(s.createdAt, DAY)).length),
    new7d: D(actionable.filter((s) => inWindow(s.createdAt, 7 * DAY)).length),
    new30d: D(actionable.filter((s) => inWindow(s.createdAt, 30 * DAY)).length),
    demandHours: metric(dHours, 'derived_actual', { coverage: 1, freshnessAt: iso, caveat: `Actionable demand × ${p.avgHandlingMinutes} min avg handling (Manual assumption).` }),
    availableHours: metric(aHours, 'manual', { coverage: aHours > 0 ? 1 : 0, freshnessAt: iso, caveat: 'From support headcount × productive hours × target utilization (Manual capacity).' }),
    utilization: metric(aHours > 0 ? utilOf(dHours, aHours) : null, aHours > 0 ? 'derived_actual' : 'manual', { coverage: aHours > 0 ? 1 : 0, freshnessAt: iso, caveat: aHours > 0 ? undefined : 'Add support capacity in Team to compute utilization.' }),
    slaAtRisk: metric(actionable.filter((s) => s.ageHours > p.slaHours).length, 'estimate', { coverage: 1, freshnessAt: iso, caveat: `Open >${p.slaHours}h. Estimate — no true ticket SLA source yet.` }),
    customersAffected: D(affectedIds.size),
    payingMrrAffectedCents: metric(mrr, 'estimate', { coverage: 1, freshnessAt: iso, caveat: 'Paying MRR (list price) of tenants with an actionable operational signal.' }),
    trialsAffected: D(trials),
    byChannel: [...byChannelMap.entries()].map(([channel, count]) => ({ channel, count })).sort((a, b) => b.count - a.count),
    byIssue: [...byIssueAgg.entries()].map(([issue, e]) => ({ issue, count: e.count, derivedShare: e.count > 0 ? e.derived / e.count : 0 })).sort((a, b) => b.count - a.count),
    freshnessAt: iso,
  }
}

export interface SupportQueueRow {
  signalId: string; tenantId: string; name: string; plan: string; lifecycle: string
  issue: IssueType; issueDerived: boolean; severity: Severity; kind: SignalKind
  openHours: number; lastActivityAt: string; owner: string | null; mrrCents: number; healthBucket: string
  recommendedAction: string; overlay: SupportOverlay | null
}

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
function recommend(s: SupportSignal, issue: IssueType): string {
  if (s.kind === 'channel_down') return `Reconnect the ${s.channel ?? 'channel'} integration`
  if (s.kind === 'channel_unverified') return `Complete ${s.channel === 'sms' ? 'A2P/SMS' : 'number'} verification`
  if (s.kind === 'message_failure') return `Investigate ${s.channel ?? 'message'} delivery failure${s.errorCode ? ` (error ${s.errorCode})` : ''}`
  if (s.kind === 'human_takeover') return 'Review AI handling / assist the customer'
  return `Triage and classify (${issue})`
}

export function buildSupportQueue(signals: SupportSignal[], tenants: Map<string, AffectedTenant>, overlays: Map<string, SupportOverlay>): SupportQueueRow[] {
  const rows = signals.filter(isActionable).map((s) => {
    const t = tenants.get(s.tenantId)
    const ov = overlays.get(s.id) ?? null
    const derived = deriveIssueType(s)
    const issue = (ov?.issueType as IssueType) || derived.issue
    const severity = (ov?.severity as Severity) || severityOf(s, t?.mrrCents ?? 0)
    return {
      signalId: s.id, tenantId: s.tenantId, name: t?.name ?? s.tenantId.slice(0, 8), plan: t?.plan ?? 'unknown', lifecycle: t?.lifecycle ?? 'unknown',
      issue, issueDerived: !ov?.issueType && derived.derived, severity, kind: s.kind,
      openHours: s.ageHours, lastActivityAt: s.createdAt, owner: ov?.owner ?? null, mrrCents: t?.mrrCents ?? 0, healthBucket: t?.healthBucket ?? 'unknown',
      recommendedAction: recommend(s, issue), overlay: ov,
    }
  })
  return rows.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.mrrCents - a.mrrCents || b.openHours - a.openHours)
}
