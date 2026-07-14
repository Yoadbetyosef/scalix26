import { type ExclusionRules, DEFAULT_EXCLUSIONS } from './exclusions'
import { getCustomerModels, type CustomerModel } from './adapters'
import { summarizeSupport, buildSupportQueue, type SupportSignal, type AffectedTenant, type SupportOps, type SupportQueueRow } from './support-ops'
import { getSupportOverlays } from './support-store'
import { getTeamRoles } from './team-store'
import { roleWorkload, capacityDistribution, fullyLoadedMonthlyCents, type RoleWorkload, type CapacityDriver, type CapacityDistribution } from './capacity-v2'

// Founder-only server adapters that turn REAL operational metadata into the Support & Ops and Team & Capacity
// views. Reads conversation/message/channel STATUS only — never content. Excluded (internal/test/free)
// tenants are dropped. Manual assumptions (handling time, SLA window) are labeled as such downstream.

const DEFAULT_HANDLING_MIN = 20 // Manual assumption — avg minutes to resolve one actionable operational signal
const DEFAULT_SLA_HOURS = 48    // Manual assumption — open-duration beyond which an item is "at SLA risk"

export interface OpsRaw {
  conversations: Array<{ id: string; tenant_id: string; channel: string | null; status: string | null; human_takeover: boolean | null; created_at: string; updated_at: string | null }>
  messageFailures: Array<{ id: string; conversation_id: string | null; tenant_id: string; channel: string | null; error_code: string | null; timestamp: string | null }>
  channels: Array<{ id: string; tenant_id: string; type: string | null; status: string | null; sms_status: string | null; created_at: string }>
  partners: Array<{ id: string; partner_type: string | null; status: string | null }>
}
export interface OpsDeps { loadOps(tenantIds: string[]): Promise<OpsRaw> }

const dbDeps: OpsDeps = {
  async loadOps(tenantIds) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const db = createAdminClient()
    const [conversations, messageFailures, channels, partners] = await Promise.all([
      db.from('conversations').select('id, tenant_id, channel, status, human_takeover, created_at, updated_at').in('tenant_id', tenantIds),
      db.from('messages').select('id, conversation_id, tenant_id, channel, error_code, timestamp').or('delivery_status.in.(failed,undelivered),error_code.not.is.null').in('tenant_id', tenantIds),
      db.from('channels').select('id, tenant_id, type, status, sms_status, created_at').in('tenant_id', tenantIds),
      db.from('partners').select('id, partner_type, status'),
    ])
    return {
      conversations: (conversations.data as OpsRaw['conversations']) ?? [],
      messageFailures: (messageFailures.data as OpsRaw['messageFailures']) ?? [],
      channels: (channels.data as OpsRaw['channels']) ?? [],
      partners: (partners.data as OpsRaw['partners']) ?? [],
    }
  },
}
let deps: OpsDeps = dbDeps
export function __setOpsDepsForTests(d: OpsDeps | null) { deps = d ?? dbDeps }

const ageHours = (iso: string | null, nowMs: number) => Math.max(0, Math.floor((nowMs - new Date(iso ?? 0).getTime()) / 3_600_000))

// PURE: raw operational rows → signals. Open conversations kept as a product-usage signal; the summarizer
// excludes them from actionable Scalix demand.
export function buildSupportSignals(raw: OpsRaw, nowMs: number): SupportSignal[] {
  const out: SupportSignal[] = []
  for (const c of raw.conversations) {
    if (c.human_takeover) out.push({ id: c.id, kind: 'human_takeover', tenantId: c.tenant_id, channel: c.channel, ageHours: ageHours(c.updated_at ?? c.created_at, nowMs), createdAt: c.updated_at ?? c.created_at })
    else if (c.status === 'open') out.push({ id: c.id, kind: 'open_conversation', tenantId: c.tenant_id, channel: c.channel, ageHours: ageHours(c.updated_at ?? c.created_at, nowMs), createdAt: c.updated_at ?? c.created_at })
  }
  for (const m of raw.messageFailures) out.push({ id: m.conversation_id ?? m.id, kind: 'message_failure', tenantId: m.tenant_id, channel: m.channel, ageHours: ageHours(m.timestamp, nowMs), createdAt: m.timestamp ?? new Date(nowMs).toISOString(), errorCode: m.error_code })
  for (const ch of raw.channels) {
    if (ch.status === 'disconnected') out.push({ id: ch.id, kind: 'channel_down', tenantId: ch.tenant_id, channel: ch.type, ageHours: ageHours(ch.created_at, nowMs), createdAt: ch.created_at })
    else if (ch.sms_status === 'pending_verification') out.push({ id: ch.id, kind: 'channel_unverified', tenantId: ch.tenant_id, channel: ch.type, ageHours: ageHours(ch.created_at, nowMs), createdAt: ch.created_at })
  }
  return out
}

function tenantMap(models: CustomerModel[]): Map<string, AffectedTenant> {
  return new Map(models.map((m) => [m.id, { name: m.name, plan: m.isTrial ? 'trial' : 'paid', mrrCents: m.planPriceCents, isTrial: m.isTrial, healthBucket: m.healthBucket, lifecycle: m.lifecycle }]))
}

async function supportCapacity() {
  const roles = await getTeamRoles()
  const support = roles.filter((r) => r.department === 'support')
  const headcount = support.reduce((s, r) => s + r.currentHeadcount, 0)
  const productiveHoursEachPerPeriod = support.length > 0 ? Math.max(...support.map((r) => r.capacityPerEmployee)) : 0
  const utilizationTarget = support.length > 0 ? support[0].targetUtilization : 0.8
  return { headcount, productiveHoursEachPerPeriod, utilizationTarget }
}

export interface SupportOpsResult { ops: SupportOps; queue: SupportQueueRow[]; actionableDemandHours: number; agencies: number; affiliates: number }

export async function getSupportOps(rules: ExclusionRules = DEFAULT_EXCLUSIONS): Promise<SupportOpsResult> {
  const models = await getCustomerModels(rules)
  const ids = models.map((m) => m.id)
  const [raw, overlays, capacity] = await Promise.all([deps.loadOps(ids), getSupportOverlays(), supportCapacity()])
  const nowMs = Date.now()
  const idSet = new Set(ids)
  const signals = buildSupportSignals(raw, nowMs).filter((s) => idSet.has(s.tenantId))
  const tenants = tenantMap(models)
  const ops = summarizeSupport(signals, tenants, { avgHandlingMinutes: DEFAULT_HANDLING_MIN, capacity, nowMs, nowIso: new Date(nowMs).toISOString(), slaHours: DEFAULT_SLA_HOURS })
  const queue = buildSupportQueue(signals, tenants, new Map(overlays.map((o) => [o.signalId, o])))
  return {
    ops, queue, actionableDemandHours: ops.demandHours.value ?? 0,
    agencies: raw.partners.filter((p) => p.partner_type === 'white_label' && p.status === 'active').length,
    affiliates: raw.partners.filter((p) => p.partner_type === 'affiliate' && p.status === 'active').length,
  }
}

// ── Team & Capacity V2 ───────────────────────────────────────────────────────────────────────────────
export interface TeamCapacity {
  workloads: RoleWorkload[]
  distribution: CapacityDistribution
  totalFullyLoadedMonthlyCents: number
  recommendedHires: RoleWorkload[]
  drivers: Record<CapacityDriver, number | null>
  freshnessAt: string
}

export async function getTeamCapacity(rules: ExclusionRules = DEFAULT_EXCLUSIONS): Promise<TeamCapacity> {
  const [roles, models, support] = await Promise.all([getTeamRoles(), getCustomerModels(rules), getSupportOps(rules)])
  const drivers: Record<CapacityDriver, number | null> = {
    support_hours: support.actionableDemandHours,
    onboarding_accounts: models.filter((m) => !m.adopted).length,
    cs_customers: models.filter((m) => m.activated).length,
    producing_agencies: support.agencies,   // active white-label partners
    active_affiliates: support.affiliates,   // active affiliate partners (0 today)
    sales_opportunities: null, // no Scalix sales-pipeline source of truth yet → Manual/Waiting
    manual: null,
  }
  const workloads = roles.map((r) => roleWorkload(r, drivers[r.capacityDriver]))
  return {
    workloads,
    distribution: capacityDistribution(workloads),
    totalFullyLoadedMonthlyCents: roles.reduce((s, r) => s + fullyLoadedMonthlyCents(r), 0),
    recommendedHires: workloads.filter((w) => w.recommendation !== null),
    drivers,
    freshnessAt: new Date().toISOString(),
  }
}
