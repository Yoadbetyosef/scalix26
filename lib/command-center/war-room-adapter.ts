import { type ExclusionRules, DEFAULT_EXCLUSIONS } from './exclusions'
import { getRealitySnapshot, getTrialConversion, getCustomerModels, buildOnboardingCases } from './adapters'
import { getOverlays } from './onboarding-overlay'
import { isOutsideSla } from './queue-logic'
import { getTeamCapacity } from './ops-adapters'
import { computeGaps, sortByPriority, type WarRoomGap, type WarRoomInput } from './war-room'
import { getWarRoomTasks, type WarRoomTask } from './war-room-store'

// Founder-only War Room adapter. Gaps are computed READ-ONLY from real state (no writes on read); the founder
// explicitly accepts a gap to persist it. Failed-payment demand comes from the event stream (reliable from
// 2026-07-14) — before that it is simply 0, never inferred.

const PAID_OPPORTUNITY_CENTS = 39700
const DAY = 86_400_000

export interface WarRoomDataDeps { recentFailedPayments(sinceIso: string): Promise<{ count: number; mrrCents: number }> }
const dbDeps: WarRoomDataDeps = {
  async recentFailedPayments(sinceIso) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_lifecycle_events').select('mrr_cents').eq('kind', 'failed_payment').gte('occurred_at', sinceIso)
    const rows = (data as Array<{ mrr_cents: number | null }> | null) ?? []
    return { count: rows.length, mrrCents: rows.reduce((s, r) => s + (r.mrr_cents ?? 0), 0) }
  },
}
let deps: WarRoomDataDeps = dbDeps
export function __setWarRoomDataDepsForTests(d: WarRoomDataDeps | null) { deps = d ?? dbDeps }

export interface WarRoom { gaps: WarRoomGap[]; tasks: WarRoomTask[]; freshnessAt: string }

export async function getWarRoom(rules: ExclusionRules = DEFAULT_EXCLUSIONS): Promise<WarRoom> {
  const nowMs = Date.now()
  const [r, tc, models, overlays, team, failed, tasks] = await Promise.all([
    getRealitySnapshot(rules), getTrialConversion(rules), getCustomerModels(rules), getOverlays(), getTeamCapacity(rules),
    deps.recentFailedPayments(new Date(nowMs - 30 * DAY).toISOString()), getWarRoomTasks(),
  ])
  const cases = buildOnboardingCases(models, overlays)
  const onboardingOutsideSla = cases.filter((c) => isOutsideSla(c, nowMs)).length
  const overloadedRoles = team.workloads.filter((w) => w.status === 'overloaded').map((w) => ({ role: w.role.role, backlog: w.backlog }))

  const input: WarRoomInput = {
    activeTrials: r.activeTrials.value ?? 0, trialMrrOpportunityCents: tc.trialMrrOpportunityCents,
    atRiskCount: r.atRisk.length, revenueAtRiskCents: r.revenueAtRiskCents.value ?? 0, criticalCount: r.healthDistribution.critical,
    activatedNotPaid: tc.activatedNotPaid, activatedNotPaidMrrCents: tc.activatedNotPaid * PAID_OPPORTUNITY_CENTS,
    onboardingOutsideSla,
    failedPayments: failed.count, failedPaymentMrrCents: failed.mrrCents,
    overloadedRoles,
  }
  // Suppress gaps already captured as a live task (dedup by gapKey).
  const liveKeys = new Set(tasks.filter((t) => t.status === 'open' || t.status === 'in_progress').map((t) => t.gapKey).filter(Boolean))
  const gaps = sortByPriority(computeGaps(input)).filter((g) => !liveKeys.has(g.gapKey))
  return { gaps, tasks, freshnessAt: new Date(nowMs).toISOString() }
}
