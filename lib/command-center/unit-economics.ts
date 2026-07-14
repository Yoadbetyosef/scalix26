// Unit Economics — canonical formulas. What we can compute from REALITY (ARPU, revenue per plan/engine) is
// Derived Actual; gross margin becomes computable once actual COGS are entered; CAC/LTV/payback/churn/NRR/GRR
// require data we don't have yet (acquisition spend, event-sourced retention) and are surfaced as
// Waiting for Data — never invented. Pure + tested.

export interface UnitEconInput {
  mrrCents: number; payingCustomers: number
  monthlyCogsCents: number | null // null = no actual cost data entered yet
}
export interface UnitEcon {
  arpuCents: number | null
  grossMarginPct: number | null
  costToServeCents: number | null      // monthly COGS per paying customer
  contributionPerCustomerCents: number | null
}
export function unitEconomics(i: UnitEconInput): UnitEcon {
  const arpu = i.payingCustomers > 0 ? Math.round(i.mrrCents / i.payingCustomers) : null
  const grossMargin = i.monthlyCogsCents != null && i.mrrCents > 0 ? (i.mrrCents - i.monthlyCogsCents) / i.mrrCents : null
  const costToServe = i.monthlyCogsCents != null && i.payingCustomers > 0 ? Math.round(i.monthlyCogsCents / i.payingCustomers) : null
  const contribution = arpu != null && costToServe != null ? arpu - costToServe : null
  return { arpuCents: arpu, grossMarginPct: grossMargin, costToServeCents: costToServe, contributionPerCustomerCents: contribution }
}

// Revenue/margin per plan or engine (revenue is Derived Actual; margin needs cost allocation → null until costs).
export interface Segment { key: string; label: string; customers: number; mrrCents: number }
export interface SegmentEcon extends Segment { arpuCents: number | null; sharePct: number }
export function segmentEconomics(segments: Segment[]): SegmentEcon[] {
  const totalMrr = segments.reduce((s, x) => s + x.mrrCents, 0)
  return segments.map((s) => ({ ...s, arpuCents: s.customers > 0 ? Math.round(s.mrrCents / s.customers) : null, sharePct: totalMrr > 0 ? s.mrrCents / totalMrr : 0 }))
}
