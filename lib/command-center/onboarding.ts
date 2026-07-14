// Onboarding funnel — HONEST two-layer model. The system-observed stage is only marked 'done' when the
// data proves it; otherwise 'unknown' (the checklist JSON is sparse, so we never pretend). A later stage
// only implies an earlier one when the business sequence GUARANTEES it (a paid subscription guarantees
// signed-up; a real value event guarantees a live channel). A separate manual operational stage (owner
// overlay) lives in cc_onboarding_overlay. Pure + tested.

export type StageKey = 'signed_up' | 'payment_complete' | 'setup_complete' | 'technically_live' | 'activated' | 'adopted'
export type StageState = 'done' | 'unknown' | 'not_reached'
export const STAGE_ORDER: StageKey[] = ['signed_up', 'payment_complete', 'setup_complete', 'technically_live', 'activated', 'adopted']

export interface OnboardingSignals {
  hasSubscription: boolean          // proven payment
  requiredStepsComplete: boolean | null // from checklist: true/false, or null when unprovable (sparse)
  liveChannels: number              // operational channels (proven live)
  activated: boolean                // a real value event occurred
  adopted: boolean
}

// Per-stage observed state. Guaranteed implications only.
export function observedStages(s: OnboardingSignals): Record<StageKey, StageState> {
  const activatedGuaranteesLive = s.activated // a value event requires a working channel
  return {
    signed_up: 'done', // the tenant exists
    payment_complete: s.hasSubscription ? 'done' : 'unknown',
    setup_complete: s.requiredStepsComplete === true ? 'done' : s.requiredStepsComplete === false ? 'not_reached' : 'unknown',
    technically_live: s.liveChannels > 0 || activatedGuaranteesLive ? 'done' : 'unknown',
    activated: s.activated ? 'done' : 'not_reached',
    adopted: s.adopted ? 'done' : 'not_reached',
  }
}

// Furthest PROVEN stage (highest stage that is 'done'); unknowns don't advance it.
export function furthestObserved(s: OnboardingSignals): StageKey {
  const st = observedStages(s)
  let furthest: StageKey = 'signed_up'
  for (const k of STAGE_ORDER) if (st[k] === 'done') furthest = k
  return furthest
}

export interface FunnelCell { stage: StageKey; done: number; unknown: number; notReached: number }
export interface Funnel { cells: FunnelCell[]; total: number; unknownStages: StageKey[] }

export function buildFunnel(customers: OnboardingSignals[]): Funnel {
  const cells: FunnelCell[] = STAGE_ORDER.map((stage) => ({ stage, done: 0, unknown: 0, notReached: 0 }))
  for (const c of customers) {
    const st = observedStages(c)
    STAGE_ORDER.forEach((stage, i) => {
      const state = st[stage]
      if (state === 'done') cells[i].done++
      else if (state === 'unknown') cells[i].unknown++
      else cells[i].notReached++
    })
  }
  const unknownStages = cells.filter((c) => c.unknown > 0).map((c) => c.stage)
  return { cells, total: customers.length, unknownStages }
}
