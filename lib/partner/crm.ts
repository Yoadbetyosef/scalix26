// Shared CRM constants (isomorphic — safe in client components). Scalix V3 sales funnel.
export const CRM_STAGES = ['lead', 'qualified', 'demo_generated', 'demo_viewed', 'business_called_ai', 'trial', 'onboarding', 'paid', 'expansion', 'lost'] as const
export type CrmStage = typeof CRM_STAGES[number]

export const STAGE_LABEL: Record<CrmStage, string> = {
  lead: 'Lead', qualified: 'Qualified', demo_generated: 'Demo Generated', demo_viewed: 'Demo Viewed',
  business_called_ai: 'Called AI', trial: 'Trial', onboarding: 'Onboarding', paid: 'Paid', expansion: 'Expansion', lost: 'Lost',
}

// Board columns (lost is shown but as an outcome column at the end).
export const PIPELINE_COLUMNS: CrmStage[] = ['lead', 'qualified', 'demo_generated', 'demo_viewed', 'business_called_ai', 'trial', 'onboarding', 'paid', 'expansion', 'lost']

export const STAGE_COLOR: Record<CrmStage, string> = {
  lead: 'bg-gray-100 text-gray-600', qualified: 'bg-blue-50 text-blue-700', demo_generated: 'bg-indigo-50 text-indigo-700',
  demo_viewed: 'bg-violet-50 text-violet-700', business_called_ai: 'bg-cyan-50 text-cyan-700', trial: 'bg-amber-50 text-amber-700',
  onboarding: 'bg-sky-50 text-sky-700', paid: 'bg-green-50 text-green-700', expansion: 'bg-emerald-50 text-emerald-700', lost: 'bg-red-50 text-red-600',
}
