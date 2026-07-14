import { type ExclusionRules, DEFAULT_EXCLUSIONS } from './exclusions'
import { getRealitySnapshot } from './adapters'
import { getCostItems } from './cost-store'
import { summarizeCosts, type CostItem, type CostSummary } from './costs'
import { unitEconomics, segmentEconomics, type UnitEcon, type SegmentEcon } from './unit-economics'

// Founder-only finance adapter. Revenue is run-rate MRR by stream (Derived Actual — from real plans, not
// Stripe-collected). Costs are actual/manual. Gross margin/contribution become real once costs are entered;
// CAC/LTV/payback/churn need data we don't have yet and are surfaced as Waiting for Data by the pages.

export interface RevenueStream { key: string; label: string; monthlyCents: number; source: 'derived_actual' | 'waiting' }
export interface Finance {
  currentMrrCents: number; runRateArrCents: number; payingCustomers: number
  streams: RevenueStream[]
  costs: CostSummary; costItems: CostItem[]
  unitEcon: UnitEcon; segments: SegmentEcon[]
  freshnessAt: string
}

export async function getFinance(rules: ExclusionRules = DEFAULT_EXCLUSIONS): Promise<Finance> {
  const [r, costItems] = await Promise.all([getRealitySnapshot(rules), getCostItems()])
  const nowIso = new Date().toISOString()
  const costs = summarizeCosts(costItems, nowIso)
  const mrr = r.currentMrrCents.value ?? 0
  const paying = r.payingCustomers.value ?? 0
  const eng = (k: 'direct' | 'affiliate' | 'whiteLabel') => r.byEngine.find((e) => e.engine === k) ?? { paying: 0, mrrCents: 0 }

  const streams: RevenueStream[] = [
    { key: 'direct', label: 'Direct subscription MRR', monthlyCents: eng('direct').mrrCents, source: 'derived_actual' },
    { key: 'affiliate', label: 'Affiliate-sourced gross MRR', monthlyCents: eng('affiliate').mrrCents, source: 'derived_actual' },
    { key: 'whiteLabel', label: 'White Label account MRR', monthlyCents: eng('whiteLabel').mrrCents, source: 'derived_actual' },
    { key: 'expansion', label: 'Expansion MRR', monthlyCents: 0, source: 'waiting' },
    { key: 'setup', label: 'Setup / one-time fees', monthlyCents: 0, source: 'waiting' },
  ]
  const segments = segmentEconomics([
    { key: 'direct', label: 'Direct', customers: eng('direct').paying, mrrCents: eng('direct').mrrCents },
    { key: 'affiliate', label: 'Affiliate', customers: eng('affiliate').paying, mrrCents: eng('affiliate').mrrCents },
    { key: 'whiteLabel', label: 'White Label', customers: eng('whiteLabel').paying, mrrCents: eng('whiteLabel').mrrCents },
  ])
  return {
    currentMrrCents: mrr, runRateArrCents: r.runRateArrCents.value ?? 0, payingCustomers: paying,
    streams, costs, costItems,
    unitEcon: unitEconomics({ mrrCents: mrr, payingCustomers: paying, monthlyCogsCents: costItems.length > 0 ? costs.monthlyCogsCents : null }),
    segments, freshnessAt: nowIso,
  }
}
