import { type Cents, roundCents } from './money'
import type { ForecastResult } from './types'

// CEO Priority Engine — DETERMINISTIC ranking of the company's biggest problems/opportunities. Each item
// carries an ESTIMATED ARR impact, a priority level, a recommended action, and a playbookKey. This is the
// "3 highest-priority problems every morning." Benchmarks are editable defaults (Phase 2b lets the founder
// tune them / attach explicit engine targets). Estimates are clearly labeled as estimates, not precision.

export interface Benchmarks {
  affiliateActivation: number
  expansionPct: number
  monthlyChurn: number
  grossMargin: number
  minRunwayMonths: number
  maxCacPaybackMonths: number
}
export const DEFAULT_BENCHMARKS: Benchmarks = {
  affiliateActivation: 0.35, expansionPct: 0.15, monthlyChurn: 0.03, grossMargin: 0.7, minRunwayMonths: 6, maxCacPaybackMonths: 12,
}

export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low'
export interface Priority {
  id: string
  title: string
  detail: string
  priority: PriorityLevel
  estimatedArrImpactCents: Cents // 0 when not quantifiable
  recommendedAction: string
  playbookKey?: string
}
const WEIGHT: Record<PriorityLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const p0 = (x: number) => `${(x * 100).toFixed(0)}%`
const p1 = (x: number) => `${(x * 100).toFixed(1)}%`

export function computePriorities(f: ForecastResult, monthIndex = 0, b: Benchmarks = DEFAULT_BENCHMARKS): Priority[] {
  const a = f.assumptions
  const m = f.months[monthIndex]
  const arpu = m.arpuCents
  const arrPerCustomer = arpu * 12 // annual value of one customer
  const bump = (impact: Cents): PriorityLevel => (impact > arrPerCustomer * 50 ? 'high' : 'medium')
  const out: Priority[] = []

  // Runway — always critical.
  if (m.runwayMonths !== null && m.runwayMonths < b.minRunwayMonths) {
    out.push({ id: 'runway', priority: 'critical', estimatedArrImpactCents: 0,
      title: 'Cash runway below safe threshold',
      detail: `Runway is ${m.runwayMonths.toFixed(1)} months (min ${b.minRunwayMonths}). Extend runway before scaling spend.`,
      recommendedAction: 'Raise capital or cut burn to extend runway past 12 months.', playbookKey: 'fundraising' })
  }
  // Affiliate activation gap → extra customers a year at target × annual value.
  if (a.affiliate.activationRate < b.affiliateActivation) {
    const extraActive = (b.affiliateActivation - a.affiliate.activationRate) * a.affiliate.recruitedPerMonth
    const extraAddsPerMonth = extraActive * a.affiliate.customersPerActiveAffiliatePerMonth
    const impact = roundCents(extraAddsPerMonth * 12 * arrPerCustomer)
    out.push({ id: 'affiliate_activation', priority: bump(impact), estimatedArrImpactCents: impact,
      title: 'Affiliate activation below target',
      detail: `Activation is ${p0(a.affiliate.activationRate)} vs ${p0(b.affiliateActivation)} target.`,
      recommendedAction: 'Launch an affiliate activation campaign (onboarding + first-sale incentives).', playbookKey: 'affiliate_growth' })
  }
  // Expansion below target share of MRR.
  const targetExpansion = roundCents(m.grossMrrCents * b.expansionPct)
  if (m.expansionMrrCents < targetExpansion) {
    const impact = roundCents((targetExpansion - m.expansionMrrCents) * 12)
    out.push({ id: 'expansion', priority: bump(impact), estimatedArrImpactCents: impact,
      title: 'Expansion revenue below target',
      detail: `Expansion is ${p0(m.grossMrrCents > 0 ? m.expansionMrrCents / m.grossMrrCents : 0)} of MRR vs ${p0(b.expansionPct)} target.`,
      recommendedAction: 'Launch an expansion campaign (add-on adoption + upgrade nudges).', playbookKey: 'expansion' })
  }
  // Churn above target → customers saved a year × annual value.
  if (a.retention.monthlyLogoChurn > b.monthlyChurn) {
    const savedPerMonth = m.beginCustomers * (a.retention.monthlyLogoChurn - b.monthlyChurn)
    const impact = roundCents(savedPerMonth * 12 * arrPerCustomer)
    out.push({ id: 'churn', priority: 'high', estimatedArrImpactCents: impact,
      title: 'Churn above target',
      detail: `Logo churn is ${p1(a.retention.monthlyLogoChurn)}/mo vs ${p1(b.monthlyChurn)} target.`,
      recommendedAction: 'Prioritize retention: onboarding, health scoring and save flows.', playbookKey: 'retention' })
  }
  // CAC payback too long.
  if (m.cacPaybackMonths !== null && m.cacPaybackMonths > b.maxCacPaybackMonths) {
    out.push({ id: 'cac_payback', priority: 'medium', estimatedArrImpactCents: 0,
      title: 'CAC payback too long',
      detail: `Payback is ${m.cacPaybackMonths.toFixed(1)} months vs ${b.maxCacPaybackMonths} target.`,
      recommendedAction: 'Reduce paid budget or improve funnel conversion.', playbookKey: 'paid_efficiency' })
  }
  // Gross margin below target.
  if (m.grossMargin < b.grossMargin) {
    out.push({ id: 'gross_margin', priority: 'medium', estimatedArrImpactCents: 0,
      title: 'Gross margin below target',
      detail: `Margin is ${p0(m.grossMargin)} vs ${p0(b.grossMargin)} target.`,
      recommendedAction: 'Reduce COGS: usage efficiency, support automation and processing fees.', playbookKey: 'paid_efficiency' })
  }

  return out.sort((x, y) => WEIGHT[x.priority] - WEIGHT[y.priority] || y.estimatedArrImpactCents - x.estimatedArrImpactCents)
}
