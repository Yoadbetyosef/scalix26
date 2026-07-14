import { type ExclusionRules, DEFAULT_EXCLUSIONS } from './exclusions'
import { getRealitySnapshot, getTrialConversion } from './adapters'
import { loadActiveAssumptions } from './active'
import { getActivePlan, type PlanRow } from './plan-store'
import { computePlan, type PlanConfig, type PlanCascade, type DailyAction, type PrimaryMetric, type EngineCapacity } from './plan'
import { DEFAULT_CALENDAR } from './plan-calendar'
import type { EngineRates } from './plan-engines'

// Founder-only Plan navigation adapter. The founder sets only the destination; everything else is calculated
// backward from REALITY + persisted assumptions, recomputed every load (dynamic). Period actuals are
// event-sourced (subscription_created, reliable from 2026-07-14) — never inferred before that. Risk actions
// come from real customer state.

const DAY = 86_400_000
export interface PlanDataDeps { periodConversions(sinceIso: string): Promise<number>; recentFailedPayments(sinceIso: string): Promise<number> }
const dbDeps: PlanDataDeps = {
  async periodConversions(sinceIso) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { count } = await createAdminClient().from('cc_lifecycle_events').select('*', { count: 'exact', head: true }).eq('kind', 'subscription_created').gte('occurred_at', sinceIso)
    return count ?? 0
  },
  async recentFailedPayments(sinceIso) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { count } = await createAdminClient().from('cc_lifecycle_events').select('*', { count: 'exact', head: true }).eq('kind', 'failed_payment').gte('occurred_at', sinceIso)
    return count ?? 0
  },
}
let deps: PlanDataDeps = dbDeps
export function __setPlanDataDepsForTests(d: PlanDataDeps | null) { deps = d ?? dbDeps }

const DEFAULT_CONFIG = (arrTarget: number): PlanConfig => ({
  primaryMetric: 'arr_cents', annualTarget: arrTarget, startDate: new Date().toISOString().slice(0, 10),
  targetDate: null, arpuTargetCents: null, monthlyGoalOverride: null, allocation: { direct: 0.45, affiliate: 0.35, whiteLabel: 0.20, expansion: 0 }, calendar: DEFAULT_CALENDAR,
})

function currentForMetric(metric: PrimaryMetric, r: Awaited<ReturnType<typeof getRealitySnapshot>>): number {
  switch (metric) {
    case 'arr_cents': return r.runRateArrCents.value ?? 0
    case 'mrr_cents': return r.currentMrrCents.value ?? 0
    case 'paying_customers': return r.payingCustomers.value ?? 0
    case 'revenue': return r.runRateArrCents.value ?? 0
    case 'profit': return 0 // Waiting for Data — no actual cost/profit source
  }
}

export interface PlanNavigation { configured: boolean; plan: PlanRow | null; config: PlanConfig; cascade: PlanCascade; freshnessAt: string }

export async function getPlanNavigation(rules: ExclusionRules = DEFAULT_EXCLUSIONS): Promise<PlanNavigation> {
  const nowMs = Date.now()
  const monthStart = new Date(Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), 1)).toISOString()
  const weekStart = new Date(nowMs - 7 * DAY).toISOString()
  const priorWeekStart = new Date(nowMs - 14 * DAY).toISOString()

  const [r, tc, planRow, active, monthConv, weekConv, priorWeekConv, failed] = await Promise.all([
    getRealitySnapshot(rules), getTrialConversion(rules), getActivePlan(), loadActiveAssumptions('command-center'),
    deps.periodConversions(monthStart), deps.periodConversions(weekStart), deps.periodConversions(priorWeekStart), deps.recentFailedPayments(weekStart),
  ])
  const a = active.assumptions
  const arpu = r.arpuCents.value ?? 0
  const config: PlanConfig = planRow
    ? { primaryMetric: planRow.primaryMetric, annualTarget: planRow.annualTarget, startDate: planRow.startDate, targetDate: planRow.targetDate, arpuTargetCents: planRow.arpuTargetCents, monthlyGoalOverride: planRow.monthlyGoalOverride, allocation: planRow.allocation, calendar: { timezone: planRow.timezone, weekStartDay: planRow.weekStartDay, workingDaysPerWeek: planRow.workingDaysPerWeek } }
    : DEFAULT_CONFIG(a.targets.targetArrCents)

  const engineRates: EngineRates = {
    direct: { closeRate: a.direct.closeRate, showRate: a.direct.showRate, bookRate: a.direct.meetingBookRate, responseRate: a.direct.emailResponseRate },
    affiliate: { customersPerActiveAffiliate: a.affiliate.customersPerActiveAffiliatePerMonth, activationRate: a.affiliate.activationRate },
    whiteLabel: { customersPerAgency: a.whiteLabel.customersPerAgencyPerMonth, launchRate: a.whiteLabel.activationRate, closeRate: a.whiteLabel.closeRate },
    expansion: { adoptionRate: a.expansion.adoptionRate, avgAddOns: a.expansion.avgAddOns, addOnCents: a.pricing.addOnCents },
    arpuCents: arpu,
  }

  const risk: DailyAction[] = []
  if (r.atRisk.length > 0) risk.push({ key: 'at_risk', action: `Review ${r.atRisk.length} at-risk customer${r.atRisk.length > 1 ? 's' : ''}`, why: `Protect ${((r.revenueAtRiskCents.value ?? 0) / 100).toFixed(0)} in MRR at risk.`, relatedGoal: 'Retention', expectedImpact: 'Prevent churn (protects the base)', engine: 'risk' })
  if (tc.activatedNotPaid > 0) risk.push({ key: 'trial_followup', action: `Follow up with ${tc.activatedNotPaid} trial${tc.activatedNotPaid > 1 ? 's' : ''}`, why: 'Activated but not paying — the warmest conversions.', relatedGoal: 'Trial conversion', expectedImpact: 'Convert trials to paid', engine: 'risk' })
  if (failed > 0) risk.push({ key: 'failed_pay', action: `Recover ${failed} failed payment${failed > 1 ? 's' : ''}`, why: 'Failed payments this week — recover before involuntary churn.', relatedGoal: 'Revenue protection', expectedImpact: 'Recover at-risk MRR', engine: 'risk' })

  // Available team outreach capacity/day (Derived from assumptions: reps × emails/rep/day). null = not configured.
  const capacity: EngineCapacity = { directOutreachPerDay: a.direct.reps > 0 && a.direct.emailsPerRepPerDay > 0 ? a.direct.reps * a.direct.emailsPerRepPerDay : null }
  const cascade = computePlan({
    config, currentValue: currentForMetric(config.primaryMetric, r), currentCustomers: r.payingCustomers.value ?? 0, currentArpuCents: arpu,
    monthActual: monthConv, weekActual: weekConv, weekPrior: Math.max(0, priorWeekConv - weekConv), engineRates, capacity, riskActions: risk, nowMs,
  })
  return { configured: !!planRow, plan: planRow, config, cascade, freshnessAt: new Date(nowMs).toISOString() }
}
