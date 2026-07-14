import type { SourceClass } from './sources'

// Canonical metric registry — ONE definition per KPI, so churn/NRR/ARPU/activation/etc. can never be
// computed two different ways. Governance metadata (formula, source class, thresholds, direction, and the
// historical reliability boundary) lives here; founder-editable targets/thresholds overlay in
// cc_metric_definitions. Pages read the label/definition/source from here.

export interface MetricDef {
  key: string
  name: string
  description: string
  formula: string
  unit: 'count' | 'pct' | 'cents' | 'hours' | 'days' | 'ratio'
  source: SourceClass
  higherIsBetter: boolean
  reliableFrom?: string | null // historical boundary; null/undefined = derivable throughout
  caveat?: string
}

export const METRICS: Record<string, MetricDef> = {
  logo_churn: { key: 'logo_churn', name: 'Logo churn', description: 'Customers lost in a period', formula: 'lost ÷ beginning customers', unit: 'pct', source: 'derived_actual', higherIsBetter: false, caveat: 'Derived from subscription/suspension state until billing_events is reliably instrumented.' },
  grr: { key: 'grr', name: 'Gross revenue retention', description: 'Revenue kept excluding expansion', formula: '1 − (churned + contraction) ÷ beginning MRR', unit: 'pct', source: 'derived_actual', higherIsBetter: true },
  nrr: { key: 'nrr', name: 'Net revenue retention', description: 'Existing-customer revenue incl. expansion (excludes new)', formula: '(beginning − churn − contraction + expansion) ÷ beginning MRR', unit: 'pct', source: 'derived_actual', higherIsBetter: true, caveat: 'New-customer revenue is excluded from the denominator by definition.' },
  activation_rate: { key: 'activation_rate', name: 'Activation rate', description: 'Customers that reached first business value', formula: 'activated ÷ countable customers', unit: 'pct', source: 'derived_actual', higherIsBetter: true, caveat: 'Activation = first lead/appointment/AI-resolved conversation/workflow outcome — never login/setup alone.' },
  adoption_rate: { key: 'adoption_rate', name: 'Adoption rate', description: 'Customers with repeated value (≥3 events / ≥2 days / 30d)', formula: 'adopted ÷ countable customers', unit: 'pct', source: 'derived_actual', higherIsBetter: true },
  onboarding_completion: { key: 'onboarding_completion', name: 'Onboarding completion', description: 'Provably setup-complete customers', formula: 'setup_complete=done ÷ countable', unit: 'pct', source: 'derived_actual', higherIsBetter: true, caveat: 'Checklist coverage is sparse — many customers show Unknown, not Complete.' },
  health_at_risk: { key: 'health_at_risk', name: 'Customers at risk', description: 'Health bucket At Risk or Critical', formula: 'count(bucket ∈ {at_risk, critical})', unit: 'count', source: 'derived_actual', higherIsBetter: false },
  support_demand_hours: { key: 'support_demand_hours', name: 'Support demand', description: 'Operational Support Proxy demand', formula: 'requests × handling minutes ÷ 60', unit: 'hours', source: 'estimate', higherIsBetter: false, caveat: 'Operational Support Proxy — no ticket system; handling time is a Manual assumption.' },
  support_utilization: { key: 'support_utilization', name: 'Support utilization', description: 'Demand vs capacity', formula: 'demand hours ÷ available hours', unit: 'pct', source: 'estimate', higherIsBetter: false },
}

export const metricDef = (key: string): MetricDef | undefined => METRICS[key]
