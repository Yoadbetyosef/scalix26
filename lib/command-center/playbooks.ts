import type { EngineKey } from './types'

// Playbook registry — every metric/insight/priority links to a playbook via playbookKey, so the dashboard
// is ACTIONABLE, not informational. Playbook CONTENT (steps/tasks) is a later phase; this is the linkage +
// metadata the decision layer references today.

export interface Playbook {
  key: string
  title: string
  engine?: EngineKey // which growth engine it belongs to (undefined = company-wide)
  opensWhen: string
}

export const PLAYBOOKS: Record<string, Playbook> = {
  direct_sales: { key: 'direct_sales', title: 'Direct Sales Playbook', engine: 'direct', opensWhen: 'Direct sales below target' },
  affiliate_growth: { key: 'affiliate_growth', title: 'Affiliate Growth Playbook', engine: 'affiliate', opensWhen: 'Affiliate activation or output is low' },
  whitelabel_acquisition: { key: 'whitelabel_acquisition', title: 'White Label Acquisition Playbook', engine: 'whiteLabel', opensWhen: 'White Label behind target' },
  expansion: { key: 'expansion', title: 'Expansion Playbook', engine: 'expansion', opensWhen: 'Expansion revenue is weak' },
  retention: { key: 'retention', title: 'Retention Playbook', opensWhen: 'Churn above target' },
  paid_efficiency: { key: 'paid_efficiency', title: 'Paid Efficiency Playbook', engine: 'direct', opensWhen: 'CAC payback or gross margin off target' },
  fundraising: { key: 'fundraising', title: 'Fundraising / Runway Playbook', opensWhen: 'Cash runway is short' },
}

export const playbookFor = (key?: string): Playbook | undefined => (key ? PLAYBOOKS[key] : undefined)
export const playbookForEngine = (engine: EngineKey): Playbook | undefined =>
  Object.values(PLAYBOOKS).find((p) => p.engine === engine)
