// Shared CRM constants (isomorphic — safe in client components).
export const CRM_STAGES = ['lead', 'qualified', 'demo_sent', 'trial', 'negotiation', 'won', 'lost', 'expansion', 'cancelled'] as const
export type CrmStage = typeof CRM_STAGES[number]

export const STAGE_LABEL: Record<CrmStage, string> = {
  lead: 'Lead', qualified: 'Qualified', demo_sent: 'Demo Sent', trial: 'Trial',
  negotiation: 'Negotiation', won: 'Won', lost: 'Lost', expansion: 'Expansion', cancelled: 'Cancelled',
}

// The active pipeline columns shown on the board (won/lost/expansion/cancelled are outcomes).
export const PIPELINE_COLUMNS: CrmStage[] = ['lead', 'qualified', 'demo_sent', 'trial', 'negotiation', 'won', 'lost']

export const STAGE_COLOR: Record<CrmStage, string> = {
  lead: 'bg-gray-100 text-gray-600', qualified: 'bg-blue-50 text-blue-700', demo_sent: 'bg-indigo-50 text-indigo-700',
  trial: 'bg-amber-50 text-amber-700', negotiation: 'bg-purple-50 text-purple-700', won: 'bg-green-50 text-green-700',
  lost: 'bg-red-50 text-red-600', expansion: 'bg-emerald-50 text-emerald-700', cancelled: 'bg-gray-100 text-gray-500',
}
