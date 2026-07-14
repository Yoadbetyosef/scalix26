import { type MetricValue, metric } from './sources'
import { type ExclusionRules, DEFAULT_EXCLUSIONS, exclusionReason, isExcluded } from './exclusions'
import { activationStatus, type ValueEvent } from './activation'
import { customerHealth, type HealthInputs, type Lifecycle, type HealthBucket } from './health'
import { observedStages, furthestObserved, buildFunnel, type OnboardingSignals, type Funnel } from './onboarding'
import { trialConversion, type TrialModel, type TrialConversion } from './trial-conversion'
import { type OnboardingCase, type OnboardingOverlay } from './onboarding-overlay'

// Founder-only server-side adapters over REAL source-of-truth tables. The row→model builder is PURE
// (unit-testable); only loadAll() touches the DB, and only from founder-gated server code. Excluded
// tenants (internal/test/free) are removed; every aggregate reports coverage + a source classification.
// Reliable event-sourced history begins at CC_RELIABLE_FROM; before that, churn/lifecycle are derived
// from current state.

export const CC_RELIABLE_FROM = '2026-07-14' // billing-event instrumentation boundary

// Real plan values include 'trial' (no MRR). Trials map to 0 explicitly so "revenue at risk" is honest,
// but note (below) that a trial-heavy base means the real early-stage risk is trial→paid conversion.
const PLAN_PRICE_CENTS: Record<string, number> = { trial: 0, free: 0, starter: 29700, pro: 39700, growth: 39700, business: 59700 }
const DAY = 86_400_000

export interface RawTenant {
  id: string; business_name: string | null; email: string | null; plan: string | null
  created_at: string; suspended_at: string | null; stripe_subscription_id: string | null
  white_label_partner_id: string | null; referred_by_partner_id: string | null
  onboarding_checklist: Record<string, boolean> | null; last_login_at: string | null
}
export interface RawTenantEvent { tenant_id: string; created_at: string }
export interface RawConversation { tenant_id: string; status: string | null; human_takeover: boolean | null; created_at: string }
export interface RawTenantRef { tenant_id: string }

export interface CommandData {
  tenants: RawTenant[]
  leads: RawTenantEvent[]
  appointments: RawTenantEvent[]
  conversations: RawConversation[]
  usageEvents: RawTenantEvent[]
  channels: RawTenantRef[]
  aiEmployees: RawTenantRef[]
}

export type Engine = 'direct' | 'affiliate' | 'whiteLabel'
export interface CustomerModel {
  id: string; name: string; engine: Engine; planPriceCents: number
  lifecycle: Lifecycle
  activated: boolean; adopted: boolean; setupComplete: boolean
  healthOverall: number; healthBucket: HealthBucket
  onboarding: Record<string, string>; observedStage: string
  outcomes30d: number
  daysSinceSignup: number; isTrial: boolean; converted: boolean; expired: boolean
}

const groupBy = <T extends { tenant_id: string }>(rows: T[]) => {
  const m = new Map<string, T[]>()
  for (const r of rows) (m.get(r.tenant_id) ?? m.set(r.tenant_id, []).get(r.tenant_id)!).push(r)
  return m
}

// PURE: build a per-tenant executive model from raw rows (no PII — counts + status only).
export function buildCustomerModels(d: CommandData, rules: ExclusionRules, nowMs: number): CustomerModel[] {
  const leads = groupBy(d.leads), appts = groupBy(d.appointments), convs = groupBy(d.conversations)
  const usage = groupBy(d.usageEvents), chans = groupBy(d.channels), emps = groupBy(d.aiEmployees)
  const inWindow = (ts: string, from: number, to: number) => { const t = new Date(ts).getTime(); return t >= from && t < to }

  return d.tenants.filter((t) => !isExcluded(t, rules)).map((t) => {
    const now = nowMs
    const daysSinceSignup = Math.max(0, Math.floor((now - new Date(t.created_at).getTime()) / DAY))
    const cLeads = leads.get(t.id) ?? [], cAppts = appts.get(t.id) ?? [], cConvs = convs.get(t.id) ?? []
    const resolved = cConvs.filter((c) => c.status === 'resolved' && !c.human_takeover)
    const valueEvents: ValueEvent[] = [
      ...cLeads.map((l) => ({ type: 'lead' as const, at: l.created_at })),
      ...cAppts.map((a) => ({ type: 'appointment' as const, at: a.created_at })),
      ...resolved.map((c) => ({ type: 'ai_resolved_conversation' as const, at: c.created_at })),
    ]
    const liveChannels = (chans.get(t.id) ?? []).length
    const checklist = t.onboarding_checklist ?? {}
    const checklistKeys = Object.keys(checklist)
    const requiredStepsComplete = checklistKeys.length === 0 ? null : checklistKeys.every((k) => checklist[k])
    const act = activationStatus({ requiredOnboardingComplete: requiredStepsComplete === true, liveChannels, valueEvents })

    const outcomes30d = valueEvents.filter((e) => inWindow(e.at, now - 30 * DAY, now)).length
    const outcomesPrev30d = valueEvents.filter((e) => inWindow(e.at, now - 60 * DAY, now - 30 * DAY)).length
    const usage30d = (usage.get(t.id) ?? []).filter((u) => inWindow(u.created_at, now - 30 * DAY, now)).length + cConvs.filter((c) => inWindow(c.created_at, now - 30 * DAY, now)).length
    const usagePrev30d = (usage.get(t.id) ?? []).filter((u) => inWindow(u.created_at, now - 60 * DAY, now - 30 * DAY)).length + cConvs.filter((c) => inWindow(c.created_at, now - 60 * DAY, now - 30 * DAY)).length
    const openSupport = cConvs.filter((c) => c.status === 'open').length
    const unresolvedSupport = cConvs.filter((c) => c.status === 'open' && c.human_takeover).length
    const lastActivityDays = Math.floor((now - Math.max(new Date(t.last_login_at ?? t.created_at).getTime(), ...cConvs.map((c) => new Date(c.created_at).getTime()), 0)) / DAY)

    const suspended = !!t.suspended_at
    const empCount = (emps.get(t.id) ?? []).length
    const lifecycle: Lifecycle = suspended ? 'suspended'
      : act.adopted && empCount > 1 ? 'expanded'
      : act.adopted ? 'established'
      : act.activated && daysSinceSignup < 30 ? 'newly_activated'
      : act.activated ? 'established'
      : daysSinceSignup < 30 ? 'onboarding' : 'churn_risk'

    const hi: HealthInputs = { lifecycle, daysSinceSignup, setupComplete: requiredStepsComplete === true, activated: act.activated, adopted: act.adopted, outcomes30d, outcomesPrev30d, usage30d, usagePrev30d, openSupport, unresolvedSupport, billingFailed: false, suspended, lastActivityDays: Math.max(0, lastActivityDays) }
    const health = customerHealth(hi)
    const onb: OnboardingSignals = { hasSubscription: !!t.stripe_subscription_id, requiredStepsComplete, liveChannels, activated: act.activated, adopted: act.adopted }
    const engine: Engine = t.white_label_partner_id ? 'whiteLabel' : t.referred_by_partner_id ? 'affiliate' : 'direct'
    const plan = (t.plan || '').toLowerCase()
    const converted = (PLAN_PRICE_CENTS[plan] ?? 0) > 0 || !!t.stripe_subscription_id
    const isTrial = !converted
    const lad = Math.max(0, lastActivityDays)

    return {
      id: t.id, name: t.business_name || t.id.slice(0, 8), engine, planPriceCents: PLAN_PRICE_CENTS[plan] ?? 0,
      lifecycle, activated: act.activated, adopted: act.adopted, setupComplete: requiredStepsComplete === true,
      healthOverall: health.overall, healthBucket: health.bucket,
      onboarding: observedStages(onb) as unknown as Record<string, string>, observedStage: furthestObserved(onb), outcomes30d,
      daysSinceSignup, isTrial, converted, expired: isTrial && lad > 30,
    }
  })
}

// ── Aggregate overviews (each metric wrapped with source + coverage) ─────────────────────────────────
export interface LifecycleOverview {
  totalCustomers: MetricValue
  byEngine: { direct: number; affiliate: number; whiteLabel: number }
  activationRate: MetricValue
  adoptionRate: MetricValue
  healthDistribution: Record<HealthBucket, number>
  atRisk: Array<{ id: string; name: string; bucket: HealthBucket; engine: Engine; mrrCents: number }>
  revenueAtRiskCents: MetricValue
  onboarding: Funnel & { completionCoverage: number }
  freshnessAt: string
}

export function summarizeLifecycle(models: CustomerModel[], nowIso: string, checklistCoverage: number): LifecycleOverview {
  const total = models.length
  const activated = models.filter((m) => m.activated).length
  const adopted = models.filter((m) => m.adopted).length
  const dist: Record<HealthBucket, number> = { healthy: 0, watch: 0, at_risk: 0, critical: 0 }
  for (const m of models) dist[m.healthBucket]++
  const atRisk = models.filter((m) => m.healthBucket === 'at_risk' || m.healthBucket === 'critical')
    .sort((a, b) => a.healthOverall - b.healthOverall)
    .map((m) => ({ id: m.id, name: m.name, bucket: m.healthBucket, engine: m.engine, mrrCents: m.planPriceCents }))
  const revenueAtRisk = atRisk.reduce((s, r) => s + r.mrrCents, 0)
  const funnel = buildFunnel(models.map((m) => ({
    hasSubscription: m.onboarding.payment_complete === 'done', requiredStepsComplete: m.onboarding.setup_complete === 'done' ? true : m.onboarding.setup_complete === 'not_reached' ? false : null,
    liveChannels: m.onboarding.technically_live === 'done' ? 1 : 0, activated: m.activated, adopted: m.adopted,
  })))
  const cov = (n: number) => (total > 0 ? n / total : 0)
  return {
    totalCustomers: metric(total, 'derived_actual', { coverage: 1, freshnessAt: nowIso }),
    byEngine: { direct: models.filter((m) => m.engine === 'direct').length, affiliate: models.filter((m) => m.engine === 'affiliate').length, whiteLabel: models.filter((m) => m.engine === 'whiteLabel').length },
    activationRate: metric(total > 0 ? activated / total : null, 'derived_actual', { coverage: cov(total), freshnessAt: nowIso, caveat: 'Activation from real value events; excludes internal/test/free tenants.' }),
    adoptionRate: metric(total > 0 ? adopted / total : null, 'derived_actual', { coverage: cov(total), freshnessAt: nowIso }),
    healthDistribution: dist,
    atRisk,
    revenueAtRiskCents: metric(revenueAtRisk, 'estimate', { coverage: cov(total), freshnessAt: nowIso, caveat: 'Paying-MRR at risk from plan list price. A trial-heavy base means most at-risk value is trial→paid conversion, not booked MRR.' }),
    onboarding: { ...funnel, completionCoverage: checklistCoverage },
    freshnessAt: nowIso,
  }
}

// ── DB layer (founder-gated callers only) ────────────────────────────────────────────────────────────
export interface AdapterDeps { loadAll(): Promise<CommandData> }

const dbDeps: AdapterDeps = {
  async loadAll() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const db = createAdminClient()
    const [tenants, leads, appointments, conversations, usageEvents, channels, aiEmployees] = await Promise.all([
      db.from('tenants').select('id, business_name, email, plan, created_at, suspended_at, stripe_subscription_id, white_label_partner_id, referred_by_partner_id, onboarding_checklist, last_login_at'),
      db.from('leads').select('tenant_id, created_at'),
      db.from('appointments').select('tenant_id, created_at'),
      db.from('conversations').select('tenant_id, status, human_takeover, created_at'),
      db.from('usage_events').select('tenant_id, created_at'),
      db.from('channels').select('tenant_id'),
      db.from('ai_employees').select('tenant_id'),
    ])
    return {
      tenants: (tenants.data as RawTenant[]) ?? [], leads: (leads.data as RawTenantEvent[]) ?? [],
      appointments: (appointments.data as RawTenantEvent[]) ?? [], conversations: (conversations.data as RawConversation[]) ?? [],
      usageEvents: (usageEvents.data as RawTenantEvent[]) ?? [], channels: (channels.data as RawTenantRef[]) ?? [], aiEmployees: (aiEmployees.data as RawTenantRef[]) ?? [],
    }
  },
}
let deps: AdapterDeps = dbDeps
export function __setAdapterDepsForTests(d: AdapterDeps | null) { deps = d ?? dbDeps }

export async function getLifecycleOverview(rules: ExclusionRules = DEFAULT_EXCLUSIONS): Promise<LifecycleOverview> {
  const data = await deps.loadAll()
  const nowIso = new Date().toISOString()
  const models = buildCustomerModels(data, rules, Date.now())
  const countableTenants = data.tenants.filter((t) => !isExcluded(t, rules))
  const withChecklist = countableTenants.filter((t) => Object.keys(t.onboarding_checklist ?? {}).length > 0).length
  return summarizeLifecycle(models, nowIso, countableTenants.length > 0 ? withChecklist / countableTenants.length : 0)
}

const PAID_OPPORTUNITY_CENTS = 39700 // avg paid plan price — trial MRR opportunity per active trial

export async function getCustomerModels(rules: ExclusionRules = DEFAULT_EXCLUSIONS): Promise<CustomerModel[]> {
  return buildCustomerModels(await deps.loadAll(), rules, Date.now())
}

export async function getTrialConversion(rules: ExclusionRules = DEFAULT_EXCLUSIONS): Promise<TrialConversion> {
  const models = await getCustomerModels(rules)
  const tm: TrialModel[] = models.map((m) => ({ isTrial: m.isTrial, converted: m.converted, activated: m.activated, adopted: m.adopted, expired: m.expired, engine: m.engine }))
  return trialConversion(tm, PAID_OPPORTUNITY_CENTS)
}

// Onboarding operational cases (still-progressing customers) merged with the manual overlay. The observed
// stage is derived; the overlay never mutates it.
export function buildOnboardingCases(models: CustomerModel[], overlays: OnboardingOverlay[]): OnboardingCase[] {
  const byTenant = new Map(overlays.map((o) => [o.tenantId, o]))
  return models.filter((m) => !m.adopted).map((m) => ({
    tenantId: m.id, name: m.name, engine: m.engine, observedStage: m.observedStage,
    daysInOnboarding: m.daysSinceSignup, mrrCents: m.planPriceCents, activated: m.activated, overlay: byTenant.get(m.id) ?? null,
  }))
}

// Exposed for the exclusions audit view.
export async function getExcludedTenants(rules: ExclusionRules = DEFAULT_EXCLUSIONS): Promise<Array<{ id: string; name: string; reason: string }>> {
  const data = await deps.loadAll()
  return data.tenants.map((t) => ({ t, reason: exclusionReason(t, rules) })).filter((x) => x.reason).map((x) => ({ id: x.t.id, name: x.t.business_name || x.t.id.slice(0, 8), reason: x.reason! }))
}
