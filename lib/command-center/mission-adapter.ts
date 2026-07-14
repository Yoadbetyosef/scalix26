import { type ExclusionRules, DEFAULT_EXCLUSIONS } from './exclusions'
import { getRealitySnapshot } from './adapters'
import { getLifecycleOverview } from './adapters'
import { getMissionMilestones, getMissionTargets } from './mission-store'
import { evaluateMilestone, requiredPathToArr, arrWaterfall, type MissionCurrent, type EvaluatedMilestone, type RequiredPath, type ArrWaterfall } from './mission-milestones'

// Founder-only Mission adapter. Current state is Derived Actual (from reality); the required path is a
// deterministic Forecast/Estimate. We have NO reliable historical growth rate yet (event history begins
// 2026-07-14), so forecast dates are intentionally null rather than invented.

export interface PartnerCounts { activeAffiliates: number; producingAgencies: number }
export interface MissionDataDeps { loadPartners(): Promise<PartnerCounts> }
const dbDeps: MissionDataDeps = {
  async loadPartners() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('partners').select('partner_type, status')
    const rows = (data as Array<{ partner_type: string | null; status: string | null }> | null) ?? []
    return {
      activeAffiliates: rows.filter((p) => p.partner_type === 'affiliate' && p.status === 'active').length,
      producingAgencies: rows.filter((p) => p.partner_type === 'white_label' && p.status === 'active').length,
    }
  },
}
let deps: MissionDataDeps = dbDeps
export function __setMissionDataDepsForTests(d: MissionDataDeps | null) { deps = d ?? dbDeps }

export interface Mission {
  current: MissionCurrent
  milestones: EvaluatedMilestone[]
  milestoneIds: Record<string, string> // milestone key → DB id (for founder edits)
  targets: Record<string, number>
  targetArrCents: number
  targetDate: string | null
  requiredPath: RequiredPath
  waterfall: ArrWaterfall
  freshnessAt: string
}

export async function getMission(rules: ExclusionRules = DEFAULT_EXCLUSIONS): Promise<Mission> {
  const [r, lc, partners, milestones, targets] = await Promise.all([getRealitySnapshot(rules), getLifecycleOverview(rules), deps.loadPartners(), getMissionMilestones(), getMissionTargets()])
  const eng = (k: 'direct' | 'affiliate' | 'whiteLabel') => r.byEngine.find((e) => e.engine === k)
  const current: MissionCurrent = {
    arrCents: r.runRateArrCents.value ?? 0,
    payingCustomers: r.payingCustomers.value ?? 0,
    arpuCents: r.arpuCents.value ?? 0,
    grossMargin: null, logoChurn: null, nrr: null, // no reliable actual source yet → Waiting for Data
    activeAffiliates: partners.activeAffiliates,
    producingAgencies: partners.producingAgencies,
    onboardingCompletion: lc.activationRate.value, // proxy: activated share (Derived Actual)
    directCustomers: eng('direct')?.paying ?? 0, affiliateCustomers: eng('affiliate')?.paying ?? 0, whiteLabelCustomers: eng('whiteLabel')?.paying ?? 0,
    directMrrCents: eng('direct')?.mrrCents ?? 0, affiliateMrrCents: eng('affiliate')?.mrrCents ?? 0, whiteLabelMrrCents: eng('whiteLabel')?.mrrCents ?? 0,
    expansionMrrCents: 0, // no expansion tracking yet
  }
  const nowMs = Date.now()
  const evaluated = milestones.map((m) => evaluateMilestone(m, current, null, nowMs))
  const targetArrCents = targets['arr_cents'] ?? 10_000_000_000 // default $100M
  const targetDate = targets['target_date_ms'] ? new Date(targets['target_date_ms']).toISOString().slice(0, 10) : null
  return {
    current, milestones: evaluated, milestoneIds: Object.fromEntries(milestones.map((m) => [m.key, m.id])),
    targets, targetArrCents, targetDate,
    requiredPath: requiredPathToArr(targetArrCents, current, nowMs, targetDate, targets['arpu_cents'] ?? 0),
    waterfall: arrWaterfall(current),
    freshnessAt: new Date(nowMs).toISOString(),
  }
}
