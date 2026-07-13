import type { ForecastResult } from './types'

// Bottleneck Detector — DETERMINISTIC executive insights (no random AI). A fixed rule set evaluates the
// forecast + assumptions and returns the biggest constraints, ranked by severity. Each rule is pure and
// unit-tested; new rules slot in without touching the engine.

export type Severity = 'high' | 'medium' | 'low'
export interface Insight {
  id: string
  title: string
  detail: string
  severity: Severity
}

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
const pctStr = (x: number) => `${(x * 100).toFixed(0)}%`

// Evaluate at a given month (default current). Returns insights most-severe first.
export function detectBottlenecks(f: ForecastResult, monthIndex = 0): Insight[] {
  const a = f.assumptions
  const m = f.months[monthIndex]
  const out: Insight[] = []

  // Runway
  if (m.runwayMonths !== null && m.runwayMonths < 6) {
    out.push({ id: 'runway', severity: 'high', title: 'Cash runway is short',
      detail: `Only ${m.runwayMonths.toFixed(1)} months of runway at the current burn — raise capital or cut spend.` })
  }
  // Affiliate activation
  if (a.affiliate.activationRate < 0.2) {
    out.push({ id: 'affiliate_activation', severity: 'high', title: 'Affiliate activation is a bottleneck',
      detail: `Only ${pctStr(a.affiliate.activationRate)} of recruited affiliates make a first sale.` })
  }
  // Gross margin
  if (m.grossMargin < 0.6) {
    out.push({ id: 'gross_margin', severity: 'medium', title: 'Gross margin below healthy SaaS range',
      detail: `Gross margin is ${pctStr(m.grossMargin)} (target 70%+). Review COGS, usage and processing costs.` })
  }
  // NRR
  if (m.nrr < 1) {
    out.push({ id: 'nrr', severity: 'medium', title: 'Net revenue retention under 100%',
      detail: `NRR is ${pctStr(m.nrr)} — expansion is not yet offsetting churn.` })
  }
  // CAC payback
  if (m.cacPaybackMonths !== null && m.cacPaybackMonths > 12) {
    out.push({ id: 'cac_payback', severity: 'medium', title: 'CAC payback is slow',
      detail: `Payback is ${m.cacPaybackMonths.toFixed(1)} months (target < 12).` })
  }
  // Churn
  if (a.retention.monthlyLogoChurn > 0.05) {
    out.push({ id: 'churn', severity: 'medium', title: 'Monthly churn is elevated',
      detail: `Logo churn is ${pctStr(a.retention.monthlyLogoChurn)}/mo — retention work will compound.` })
  }
  // Engine concentration
  const engines: Array<[string, number]> = [
    ['Direct', m.directMrrCents], ['Affiliate', m.affiliateGrossMrrCents], ['White Label', m.whiteLabelMrrCents],
  ]
  const top = engines.slice().sort((x, y) => y[1] - x[1])[0]
  if (m.grossMrrCents > 0 && top[1] / m.grossMrrCents > 0.7) {
    out.push({ id: 'concentration', severity: 'low', title: 'Revenue concentration risk',
      detail: `${top[0]} is ${pctStr(top[1] / m.grossMrrCents)} of MRR — diversify the growth engines.` })
  }
  // Positive signal: an engine outperforming Direct
  if (m.affiliateAdds > m.directAdds || m.whiteLabelAdds > m.directAdds) {
    const leader = m.whiteLabelAdds >= m.affiliateAdds ? 'White Label' : 'Affiliate'
    out.push({ id: 'engine_outperformance', severity: 'low', title: `${leader} acquisition is outperforming Direct`,
      detail: `${leader} is adding more customers/month than Direct — consider shifting investment.` })
  }

  return out.sort((x, y) => RANK[x.severity] - RANK[y.severity])
}
