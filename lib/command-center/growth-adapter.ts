import { type ExclusionRules, DEFAULT_EXCLUSIONS } from './exclusions'
import { getRealitySnapshot, getCustomerModels } from './adapters'
import { getMissionTargets } from './mission-store'
import { ENGINE_PLAYBOOKS, buildFunnel, requiredActivity, expansionGroups, type EngineKey, type FunnelStep, type RequiredActivity, type OpportunityGroup } from './growth-engines'

// Founder-only Growth Engines adapter. Current output is Derived Actual (reality); targets come from mission;
// required activity is a labeled Estimate. Un-instrumented funnel steps are shown as Waiting for Data, never
// fabricated. Partner counts come from the real partners table (source of truth) — never duplicated.

export interface GrowthEngineView {
  key: EngineKey; label: string; mission: string
  currentCustomers: number; currentMrrCents: number; activeTrials: number
  funnel: FunnelStep[]; required: RequiredActivity; bottleneckHint: string
}
export interface GrowthEngines { engines: GrowthEngineView[]; expansion: OpportunityGroup[]; expansionEligible: number; freshnessAt: string }

export interface GrowthDeps { loadPartners(): Promise<{ activeAffiliates: number; producingAgencies: number }> }
const dbDeps: GrowthDeps = {
  async loadPartners() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('partners').select('partner_type, status')
    const rows = (data as Array<{ partner_type: string | null; status: string | null }> | null) ?? []
    return { activeAffiliates: rows.filter((p) => p.partner_type === 'affiliate' && p.status === 'active').length, producingAgencies: rows.filter((p) => p.partner_type === 'white_label' && p.status === 'active').length }
  },
}
let deps: GrowthDeps = dbDeps
export function __setGrowthDepsForTests(d: GrowthDeps | null) { deps = d ?? dbDeps }

export async function getGrowthEngines(rules: ExclusionRules = DEFAULT_EXCLUSIONS): Promise<GrowthEngines> {
  const [r, models, partners, targets] = await Promise.all([getRealitySnapshot(rules), getCustomerModels(rules), deps.loadPartners(), getMissionTargets()])
  const eng = (k: 'direct' | 'affiliate' | 'whiteLabel') => r.byEngine.find((e) => e.engine === k) ?? { paying: 0, activeTrials: 0, mrrCents: 0, total: 0 }
  const totalPaying = r.payingCustomers.value ?? 0
  const targetCustomers = targets['paying_customers'] ?? null
  const nowMs = Date.now()
  const monthsToTarget = targets['target_date_ms'] ? Math.max(0, (targets['target_date_ms'] - nowMs) / (30 * 86_400_000)) : null
  const shareTarget = (current: number) => (targetCustomers == null || totalPaying === 0 ? (targetCustomers == null ? null : targetCustomers / 3) : targetCustomers * (current / totalPaying))

  const d = eng('direct'), a = eng('affiliate'), w = eng('whiteLabel')
  const engines: GrowthEngineView[] = [
    { key: 'direct', label: ENGINE_PLAYBOOKS.direct.label, mission: ENGINE_PLAYBOOKS.direct.mission, currentCustomers: d.paying, currentMrrCents: d.mrrCents, activeTrials: d.activeTrials, funnel: buildFunnel(ENGINE_PLAYBOOKS.direct, { trials: d.activeTrials, paying: d.paying }), required: requiredActivity(d.paying, shareTarget(d.paying), monthsToTarget), bottleneckHint: ENGINE_PLAYBOOKS.direct.bottleneckHint },
    { key: 'affiliate', label: ENGINE_PLAYBOOKS.affiliate.label, mission: ENGINE_PLAYBOOKS.affiliate.mission, currentCustomers: a.paying, currentMrrCents: a.mrrCents, activeTrials: a.activeTrials, funnel: buildFunnel(ENGINE_PLAYBOOKS.affiliate, { recruited: partners.activeAffiliates, trials: a.activeTrials, paying: a.paying, productive: Math.min(partners.activeAffiliates, a.paying) }), required: requiredActivity(a.paying, shareTarget(a.paying), monthsToTarget), bottleneckHint: ENGINE_PLAYBOOKS.affiliate.bottleneckHint },
    { key: 'whiteLabel', label: ENGINE_PLAYBOOKS.whiteLabel.label, mission: ENGINE_PLAYBOOKS.whiteLabel.mission, currentCustomers: w.paying, currentMrrCents: w.mrrCents, activeTrials: w.activeTrials, funnel: buildFunnel(ENGINE_PLAYBOOKS.whiteLabel, { agencies: partners.producingAgencies, producing: Math.min(partners.producingAgencies, w.paying > 0 ? partners.producingAgencies : 0), customers: w.paying, mrr: Math.round(w.mrrCents / 100) }), required: requiredActivity(w.paying, shareTarget(w.paying), monthsToTarget), bottleneckHint: ENGINE_PLAYBOOKS.whiteLabel.bottleneckHint },
  ]
  const groups = expansionGroups(models)
  const eligible = models.filter((m) => m.converted && !m.isTrial).length
  engines.push({ key: 'expansion', label: ENGINE_PLAYBOOKS.expansion.label, mission: ENGINE_PLAYBOOKS.expansion.mission, currentCustomers: eligible, currentMrrCents: 0, activeTrials: 0, funnel: buildFunnel(ENGINE_PLAYBOOKS.expansion, { eligible, opportunities: groups.reduce((s, g) => s + g.count, 0) }), required: requiredActivity(0, null, null), bottleneckHint: ENGINE_PLAYBOOKS.expansion.bottleneckHint })

  return { engines, expansion: groups, expansionEligible: eligible, freshnessAt: new Date(nowMs).toISOString() }
}
