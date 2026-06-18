import { PLANS } from '@/lib/stripe/client'

// Trial accounts get one AI employee (one number). Paid tiers come from PLANS.
const TRIAL_MAX_EMPLOYEES = 1

// Max AI employees (= dedicated numbers) a tenant may have on its plan.
export function maxEmployeesForPlan(plan: string | null | undefined): number {
  if (!plan || plan === 'trial') return TRIAL_MAX_EMPLOYEES
  const p = PLANS[plan as keyof typeof PLANS]
  return p ? p.maxEmployees : TRIAL_MAX_EMPLOYEES
}

export function canAddEmployee(currentCount: number, plan: string | null | undefined): boolean {
  return currentCount < maxEmployeesForPlan(plan)
}

// Friendly, user-facing limit message (no raw numbers leaking when unlimited).
export function planLimitMessage(plan: string | null | undefined): string {
  const max = maxEmployeesForPlan(plan)
  const noun = max === 1 ? 'AI employee' : 'AI employees'
  return `Your plan includes ${max === Infinity ? 'unlimited' : max} ${noun}. Upgrade to add more.`
}
