// War Room — gap-driven daily execution. Tasks are GENERATED from real gaps between actual, target, plan,
// capacity and risk (NOT a generic to-do list). Gap computation is PURE and read-only; the founder explicitly
// accepts a gap to persist it (write). Each gap has a stable key so it de-duplicates against live tasks.
// Pure + tested. No invented data.

export type TaskScope = 'today' | 'week' | 'month'
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical'

export interface WarRoomInput {
  activeTrials: number; trialMrrOpportunityCents: number
  atRiskCount: number; revenueAtRiskCents: number; criticalCount: number
  activatedNotPaid: number; activatedNotPaidMrrCents: number
  onboardingOutsideSla: number
  failedPayments: number; failedPaymentMrrCents: number
  overloadedRoles: Array<{ role: string; backlog: number }>
}

export interface WarRoomGap {
  gapKey: string; scope: TaskScope; title: string; category: string; priority: TaskPriority
  requiredResult: number | null; expectedImpactCents: number | null; playbook: string | null
}

// Deterministic: real gaps → prioritized execution items. Empty inputs → empty list (never fabricate work).
export function computeGaps(i: WarRoomInput): WarRoomGap[] {
  const gaps: WarRoomGap[] = []
  if (i.criticalCount > 0) gaps.push({ gapKey: 'critical_health', scope: 'today', title: `Stabilize ${i.criticalCount} critical-health account${i.criticalCount > 1 ? 's' : ''}`, category: 'critical_health', priority: 'critical', requiredResult: i.criticalCount, expectedImpactCents: i.revenueAtRiskCents, playbook: null })
  if (i.failedPayments > 0) gaps.push({ gapKey: 'failed_payments', scope: 'today', title: `Recover ${i.failedPayments} failed payment${i.failedPayments > 1 ? 's' : ''}`, category: 'failed_payment', priority: 'critical', requiredResult: i.failedPayments, expectedImpactCents: i.failedPaymentMrrCents, playbook: null })
  if (i.onboardingOutsideSla > 0) gaps.push({ gapKey: 'onboarding_sla', scope: 'today', title: `Clear ${i.onboardingOutsideSla} onboarding item${i.onboardingOutsideSla > 1 ? 's' : ''} past SLA`, category: 'onboarding_sla', priority: 'high', requiredResult: i.onboardingOutsideSla, expectedImpactCents: null, playbook: null })
  if (i.atRiskCount > 0) gaps.push({ gapKey: 'at_risk', scope: 'week', title: `Intervene on ${i.atRiskCount} at-risk account${i.atRiskCount > 1 ? 's' : ''}`, category: 'at_risk', priority: 'high', requiredResult: i.atRiskCount, expectedImpactCents: i.revenueAtRiskCents, playbook: 'retention' })
  if (i.activatedNotPaid > 0) gaps.push({ gapKey: 'activation_conversion', scope: 'week', title: `Convert ${i.activatedNotPaid} activated-not-paid trial${i.activatedNotPaid > 1 ? 's' : ''}`, category: 'activation_conversion', priority: 'high', requiredResult: i.activatedNotPaid, expectedImpactCents: i.activatedNotPaidMrrCents, playbook: null })
  for (const r of i.overloadedRoles) gaps.push({ gapKey: `capacity:${r.role}`, scope: 'week', title: `Relieve capacity overload: ${r.role} (backlog ${Math.round(r.backlog)})`, category: 'capacity', priority: 'high', requiredResult: Math.round(r.backlog), expectedImpactCents: null, playbook: null })
  if (i.activeTrials > 0) gaps.push({ gapKey: 'trial_conversion', scope: 'month', title: `Progress ${i.activeTrials} active trial${i.activeTrials > 1 ? 's' : ''} toward paid`, category: 'trial_conversion', priority: 'medium', requiredResult: i.activeTrials, expectedImpactCents: i.trialMrrOpportunityCents, playbook: null })
  return gaps
}

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 }
export function sortByPriority<T extends { priority: TaskPriority; expectedImpactCents: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (b.expectedImpactCents ?? 0) - (a.expectedImpactCents ?? 0))
}
