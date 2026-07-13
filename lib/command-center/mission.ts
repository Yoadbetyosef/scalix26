import { runForecast, blendedBasePriceCents } from './engine'
import { timeToTargetMonths } from './metrics'
import type { CommandCenterAssumptions, ForecastResult } from './types'
import type { Cents } from './money'

// Mission Planner — the executive DECISION simulator. Apply company decisions (raise ARPU, hire reps, lift
// affiliate activation, cut churn, raise pricing, add marketing) as assumption deltas, recompute the whole
// company, and return before/after deltas. Pure + deterministic; the interactive UI arrives in Phase 3.

export type Decision =
  | { kind: 'increasePricingPct'; pct: number }
  | { kind: 'setBlendedPriceCents'; cents: Cents } // "increase ARPU to $X" via uniform price scaling
  | { kind: 'hireSalesReps'; count: number; salaryPerMonthCents: Cents }
  | { kind: 'setAffiliateActivation'; rate: number }
  | { kind: 'setMonthlyChurn'; rate: number }
  | { kind: 'addMarketingBudgetCents'; cents: Cents }

export function applyDecisions(base: CommandCenterAssumptions, decisions: Decision[]): CommandCenterAssumptions {
  const a = structuredClone(base)
  for (const d of decisions) {
    switch (d.kind) {
      case 'increasePricingPct': {
        const s = (c: number) => Math.round(c * (1 + d.pct))
        a.pricing.starterCents = s(a.pricing.starterCents); a.pricing.growthCents = s(a.pricing.growthCents)
        a.pricing.proCents = s(a.pricing.proCents); a.pricing.addOnCents = s(a.pricing.addOnCents)
        break
      }
      case 'setBlendedPriceCents': {
        const cur = blendedBasePriceCents(a.mix, a.pricing)
        const factor = cur > 0 ? d.cents / cur : 1
        const s = (c: number) => Math.round(c * factor)
        a.pricing.starterCents = s(a.pricing.starterCents); a.pricing.growthCents = s(a.pricing.growthCents); a.pricing.proCents = s(a.pricing.proCents)
        break
      }
      case 'hireSalesReps':
        a.direct.reps += d.count
        a.opex.payrollMonthlyCents += d.count * d.salaryPerMonthCents
        break
      case 'setAffiliateActivation': a.affiliate.activationRate = d.rate; break
      case 'setMonthlyChurn': a.retention.monthlyLogoChurn = d.rate; break
      case 'addMarketingBudgetCents': a.opex.marketingMonthlyCents += d.cents; break
    }
  }
  return a
}

export interface Pair<T> { before: T; after: T }
export interface MissionDelta {
  horizonMonth: number
  customers: Pair<number>
  mrrCents: Pair<Cents>
  arrCents: Pair<Cents>
  operatingProfitCents: Pair<Cents>
  cashCents: Pair<Cents>
  runwayMonths: Pair<number | null>
  valuationCents: Pair<Cents>
  timeToTargetMonths: Pair<number | null>
}
export interface Simulation { before: ForecastResult; after: ForecastResult; delta: MissionDelta }

export function simulate(base: CommandCenterAssumptions, decisions: Decision[], months = 60, horizonMonth = months): Simulation {
  const before = runForecast(base, months)
  const after = runForecast(applyDecisions(base, decisions), months)
  const bi = before.months[horizonMonth - 1], ai = after.months[horizonMonth - 1]
  const t = base.targets.targetArrCents
  const pair = <T,>(b: T, a: T): Pair<T> => ({ before: b, after: a })
  return {
    before, after,
    delta: {
      horizonMonth,
      customers: pair(bi.endCustomers, ai.endCustomers),
      mrrCents: pair(bi.grossMrrCents, ai.grossMrrCents),
      arrCents: pair(bi.arrCents, ai.arrCents),
      operatingProfitCents: pair(bi.operatingProfitCents, ai.operatingProfitCents),
      cashCents: pair(bi.endingCashCents, ai.endingCashCents),
      runwayMonths: pair(bi.runwayMonths, ai.runwayMonths),
      valuationCents: pair(bi.valuationCents, ai.valuationCents),
      timeToTargetMonths: pair(timeToTargetMonths(before, t), timeToTargetMonths(after, t)),
    },
  }
}
