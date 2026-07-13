import type { Cents } from './money'
import type { ForecastResult, MonthForecast, EngineKey, Health } from './types'

// North Star snapshot — the "Are we winning?" board. Derived from a single forecast month (default = the
// current month, index 0). All values are read straight off the deterministic engine; nothing is stored.

export interface NorthStar {
  mrrCents: Cents
  arrCents: Cents
  targetArrCents: Cents
  arrGapCents: Cents
  valuationCents: Cents
  targetValuationCents: Cents
  valuationGapCents: Cents
  progressToTargetPct: number // valuation / target valuation
  monthlyGrowthPct: number // MRR vs previous month
  cashCents: Cents
  runwayMonths: number | null
  netProfitCents: Cents // operating profit
  grossMargin: number
  arpuCents: Cents
  ltvCents: Cents
  cacCents: Cents
  nrr: number
  expansionPct: number // expansion MRR / gross MRR
  customers: number
  directCustomers: number
  affiliateCustomers: number
  whiteLabelCustomers: number
}

// First month the forecast reaches a target ARR (1-indexed), or null if not reached within the horizon.
export function timeToTargetMonths(f: ForecastResult, targetArrCents: number): number | null {
  const i = f.months.findIndex((m) => m.arrCents >= targetArrCents)
  return i < 0 ? null : i + 1
}

export function northStar(f: ForecastResult, monthIndex = 0): NorthStar {
  const cur = f.months[monthIndex]
  const prev = monthIndex > 0 ? f.months[monthIndex - 1] : undefined
  const t = f.assumptions.targets
  return {
    mrrCents: cur.grossMrrCents,
    arrCents: cur.arrCents,
    targetArrCents: t.targetArrCents,
    arrGapCents: Math.max(0, t.targetArrCents - cur.arrCents),
    valuationCents: cur.valuationCents,
    targetValuationCents: t.targetValuationCents,
    valuationGapCents: Math.max(0, t.targetValuationCents - cur.valuationCents),
    progressToTargetPct: t.targetValuationCents > 0 ? cur.valuationCents / t.targetValuationCents : 0,
    monthlyGrowthPct: prev && prev.grossMrrCents > 0 ? (cur.grossMrrCents - prev.grossMrrCents) / prev.grossMrrCents : 0,
    cashCents: cur.endingCashCents,
    runwayMonths: cur.runwayMonths,
    netProfitCents: cur.operatingProfitCents,
    grossMargin: cur.grossMargin,
    arpuCents: cur.arpuCents,
    ltvCents: cur.ltvCents,
    cacCents: cur.blendedCacCents,
    nrr: cur.nrr,
    expansionPct: cur.grossMrrCents > 0 ? cur.expansionMrrCents / cur.grossMrrCents : 0,
    customers: cur.endCustomers,
    directCustomers: cur.directCustomers,
    affiliateCustomers: cur.affiliateCustomers,
    whiteLabelCustomers: cur.whiteLabelCustomers,
  }
}

export interface EngineSnapshot {
  key: EngineKey
  label: string
  customers: number
  mrrCents: Cents
  contributionPct: number // of gross MRR
  addsThisMonth: number
  addsPrevMonth: number
  trend: 'up' | 'flat' | 'down'
  health: Health
}

const ENGINE_LABEL: Record<EngineKey, string> = {
  direct: 'Direct Sales', affiliate: 'Affiliate', whiteLabel: 'White Label', expansion: 'Expansion',
}

function engineFields(cur: MonthForecast, prev: MonthForecast | undefined, key: EngineKey) {
  switch (key) {
    case 'direct': return { customers: cur.directCustomers, mrr: cur.directMrrCents, adds: cur.directAdds, prevAdds: prev?.directAdds ?? 0 }
    case 'affiliate': return { customers: cur.affiliateCustomers, mrr: cur.affiliateGrossMrrCents, adds: cur.affiliateAdds, prevAdds: prev?.affiliateAdds ?? 0 }
    case 'whiteLabel': return { customers: cur.whiteLabelCustomers, mrr: cur.whiteLabelMrrCents, adds: cur.whiteLabelAdds, prevAdds: prev?.whiteLabelAdds ?? 0 }
    case 'expansion': return { customers: 0, mrr: cur.expansionMrrCents, adds: 0, prevAdds: 0 }
  }
}

// Engine health (Phase 1 heuristic; Phase 2 layers explicit weekly targets/variance on top):
//   green = producing and growing, yellow = producing but flat/slowing, red = producing nothing.
function health(mrr: Cents, adds: number, prevAdds: number): Health {
  if (mrr <= 0 && adds <= 0) return 'red'
  if (adds < prevAdds * 0.95) return 'yellow'
  return 'green'
}

export function engineSnapshots(f: ForecastResult, monthIndex = 0): EngineSnapshot[] {
  const cur = f.months[monthIndex]
  const prev = monthIndex > 0 ? f.months[monthIndex - 1] : undefined
  const keys: EngineKey[] = ['direct', 'affiliate', 'whiteLabel', 'expansion']
  return keys.map((key) => {
    const e = engineFields(cur, prev, key)
    const trend: EngineSnapshot['trend'] = key === 'expansion' ? 'flat' : e.adds > e.prevAdds * 1.02 ? 'up' : e.adds < e.prevAdds * 0.98 ? 'down' : 'flat'
    return {
      key, label: ENGINE_LABEL[key],
      customers: e.customers, mrrCents: e.mrr,
      contributionPct: cur.grossMrrCents > 0 ? e.mrr / cur.grossMrrCents : 0,
      addsThisMonth: Math.round(e.adds), addsPrevMonth: Math.round(e.prevAdds),
      trend, health: key === 'expansion' ? (e.mrr > 0 ? 'green' : 'yellow') : health(e.mrr, e.adds, e.prevAdds),
    }
  })
}
