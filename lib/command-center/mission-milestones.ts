import { type SourceClass } from './sources'

// Mission MILESTONES + required path — the ladder from current REALITY to the company target. Current values
// are Derived Actual; the required path (growth rate, forecast date, required net-new) is a deterministic
// PROJECTION labeled Forecast/Estimate — never presented as reality. Pure + tested. (This is distinct from
// mission.ts, which is the decision-simulator "Mission Planner".) No invented history.

export interface MissionCurrent {
  arrCents: number; payingCustomers: number; arpuCents: number
  grossMargin: number | null; logoChurn: number | null; nrr: number | null
  activeAffiliates: number; producingAgencies: number; onboardingCompletion: number | null
  directCustomers: number; affiliateCustomers: number; whiteLabelCustomers: number
  directMrrCents: number; affiliateMrrCents: number; whiteLabelMrrCents: number; expansionMrrCents: number
}
export interface MilestoneDef { key: string; label: string; kind: 'arr' | 'customers' | 'operational'; metricKey: string; targetValue: number; targetDate: string | null; sortOrder: number }

const LOWER_IS_BETTER = new Set(['logo_churn'])

export function currentForMetric(metricKey: string, c: MissionCurrent): number | null {
  switch (metricKey) {
    case 'arr_cents': return c.arrCents
    case 'paying_customers': return c.payingCustomers
    case 'arpu_cents': return c.arpuCents
    case 'gross_margin': return c.grossMargin
    case 'logo_churn': return c.logoChurn
    case 'nrr': return c.nrr
    case 'active_affiliates': return c.activeAffiliates
    case 'producing_agencies': return c.producingAgencies
    case 'onboarding_completion': return c.onboardingCompletion
    default: return null
  }
}

export interface EvaluatedMilestone {
  def: MilestoneDef; current: number | null; target: number
  gap: number | null; pctToTarget: number | null
  achieved: boolean; status: 'achieved' | 'on_track' | 'behind' | 'no_data'
  requiredMonthlyGrowth: number | null; forecastDate: string | null; source: SourceClass
}

const MONTH_MS = 30 * 86_400_000
const monthsUntil = (targetDate: string, nowMs: number): number => (new Date(targetDate).getTime() - nowMs) / MONTH_MS

export function evaluateMilestone(def: MilestoneDef, c: MissionCurrent, monthlyGrowthRate: number | null, nowMs: number): EvaluatedMilestone {
  const current = currentForMetric(def.metricKey, c)
  const lower = LOWER_IS_BETTER.has(def.metricKey)
  if (current == null) return { def, current: null, target: def.targetValue, gap: null, pctToTarget: null, achieved: false, status: 'no_data', requiredMonthlyGrowth: null, forecastDate: null, source: 'manual' }

  const achieved = lower ? current <= def.targetValue : current >= def.targetValue
  const gap = lower ? Math.max(0, current - def.targetValue) : Math.max(0, def.targetValue - current)
  const pctToTarget = def.targetValue !== 0 ? (lower ? (current <= def.targetValue ? 1 : def.targetValue / current) : current / def.targetValue) : null

  let requiredMonthlyGrowth: number | null = null
  let forecastDate: string | null = null
  if (!achieved && !lower && current > 0) {
    if (def.targetDate) { const m = monthsUntil(def.targetDate, nowMs); if (m > 0) requiredMonthlyGrowth = Math.pow(def.targetValue / current, 1 / m) - 1 }
    if (monthlyGrowthRate != null && monthlyGrowthRate > 0) {
      const months = Math.log(def.targetValue / current) / Math.log(1 + monthlyGrowthRate)
      if (isFinite(months) && months > 0) forecastDate = new Date(nowMs + months * MONTH_MS).toISOString().slice(0, 10)
    }
  }
  const status: EvaluatedMilestone['status'] = achieved ? 'achieved'
    : def.targetDate && forecastDate && new Date(forecastDate) <= new Date(def.targetDate) ? 'on_track' : 'behind'
  return { def, current, target: def.targetValue, gap, pctToTarget, achieved, status, requiredMonthlyGrowth, forecastDate, source: 'derived_actual' }
}

// Deterministic decomposition of what must change to reach a target ARR — Forecast/Estimate, never reality.
export interface RequiredPath {
  targetArrCents: number; currentArrCents: number; arrGapCents: number
  requiredCustomers: number; requiredNetNewCustomers: number
  requiredArpuCents: number; arpuUpliftCents: number; requiredMonthlyGrowth: number | null
  byEngine: { direct: number; affiliate: number; whiteLabel: number }
}
// targetArpuCents: the founder's target ARPU (from mission targets). If 0/unset we HOLD current ARPU and make
// up the whole gap with customers (uplift 0) — never invent an absurd per-customer figure at a tiny base.
export function requiredPathToArr(target: number, c: MissionCurrent, nowMs: number, targetDate: string | null, targetArpuCents = 0): RequiredPath {
  const currentArpu = c.arpuCents > 0 ? c.arpuCents : 0
  const requiredArpu = targetArpuCents > 0 ? targetArpuCents : currentArpu
  const requiredCustomers = requiredArpu > 0 ? Math.ceil(target / (requiredArpu * 12)) : 0
  const requiredNetNew = Math.max(0, requiredCustomers - c.payingCustomers)
  const totalCust = c.directCustomers + c.affiliateCustomers + c.whiteLabelCustomers
  const share = (n: number) => (totalCust > 0 ? n / totalCust : 1 / 3)
  let requiredMonthlyGrowth: number | null = null
  if (targetDate && c.arrCents > 0) { const m = monthsUntil(targetDate, nowMs); if (m > 0) requiredMonthlyGrowth = Math.pow(target / c.arrCents, 1 / m) - 1 }
  return {
    targetArrCents: target, currentArrCents: c.arrCents, arrGapCents: Math.max(0, target - c.arrCents),
    requiredCustomers, requiredNetNewCustomers: requiredNetNew,
    requiredArpuCents: requiredArpu, arpuUpliftCents: Math.max(0, requiredArpu - currentArpu), requiredMonthlyGrowth,
    byEngine: { direct: Math.round(requiredNetNew * share(c.directCustomers)), affiliate: Math.round(requiredNetNew * share(c.affiliateCustomers)), whiteLabel: Math.round(requiredNetNew * share(c.whiteLabelCustomers)) },
  }
}

export interface ArrWaterfall { directCents: number; affiliateCents: number; whiteLabelCents: number; expansionCents: number; totalCents: number }
export function arrWaterfall(c: MissionCurrent): ArrWaterfall {
  return { directCents: c.directMrrCents * 12, affiliateCents: c.affiliateMrrCents * 12, whiteLabelCents: c.whiteLabelMrrCents * 12, expansionCents: c.expansionMrrCents * 12, totalCents: (c.directMrrCents + c.affiliateMrrCents + c.whiteLabelMrrCents + c.expansionMrrCents) * 12 }
}
