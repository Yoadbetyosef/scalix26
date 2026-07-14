// Customer health — deterministic, explainable, LIFECYCLE-AWARE. A brand-new onboarding customer is not
// punished for having no usage yet (grace periods). Real business outcomes carry the highest positive
// weight; billing failure / no activation / declining outcomes carry the highest negative weight. Login
// activity is deliberately low-weight. Weights are editable (Settings). Pure + tested.

export type Lifecycle = 'onboarding' | 'newly_activated' | 'established' | 'expanded' | 'suspended' | 'churn_risk'
export type HealthBucket = 'healthy' | 'watch' | 'at_risk' | 'critical'
export type HealthComponent = 'outcome' | 'activation' | 'billing' | 'usage' | 'support' | 'engagement'

export type HealthWeights = Record<HealthComponent, number>
// Outcomes highest; billing + activation high; usage/support moderate; engagement (activity) low.
export const DEFAULT_HEALTH_WEIGHTS: HealthWeights = { outcome: 0.30, activation: 0.25, billing: 0.20, usage: 0.10, support: 0.10, engagement: 0.05 }

export interface HealthInputs {
  lifecycle: Lifecycle
  daysSinceSignup: number
  setupComplete: boolean
  activated: boolean
  adopted: boolean
  outcomes30d: number
  outcomesPrev30d: number
  usage30d: number
  usagePrev30d: number
  openSupport: number
  unresolvedSupport: number
  billingFailed: boolean
  suspended: boolean
  lastActivityDays: number
}

export interface HealthFactor { component: HealthComponent; delta: 'up' | 'down'; detail: string }
export interface ComponentScore { component: HealthComponent; score: number }
export interface HealthResult {
  overall: number
  bucket: HealthBucket
  components: ComponentScore[]
  factors: HealthFactor[]
  recommendedAction: string
}

const GRACE_NEUTRAL = 60
const isGrace = (i: HealthInputs) => i.lifecycle === 'onboarding' || (i.lifecycle === 'newly_activated' && i.daysSinceSignup < 14)

function score(i: HealthInputs): { comp: Record<HealthComponent, number>; factors: HealthFactor[] } {
  const f: HealthFactor[] = []
  const grace = isGrace(i)
  const trend = (cur: number, prev: number) => (cur > prev ? 'up' : cur < prev ? 'down' : 'flat')

  // Billing (hard signal).
  let billing = 100
  if (i.suspended) { billing = 0; f.push({ component: 'billing', delta: 'down', detail: 'Account suspended' }) }
  else if (i.billingFailed) { billing = 15; f.push({ component: 'billing', delta: 'down', detail: 'Payment failure' }) }
  else f.push({ component: 'billing', delta: 'up', detail: 'Billing healthy' })

  // Activation.
  let activation: number
  if (i.adopted) { activation = 100; f.push({ component: 'activation', delta: 'up', detail: 'Adopted (repeated value)' }) }
  else if (i.activated) { activation = 80; f.push({ component: 'activation', delta: 'up', detail: 'Activated (first value)' }) }
  else if (grace) { activation = GRACE_NEUTRAL } // onboarding — not punished yet
  else { activation = 20; f.push({ component: 'activation', delta: 'down', detail: 'Not activated past onboarding window' }) }
  if (!i.setupComplete && !grace) { activation = Math.min(activation, 35); f.push({ component: 'activation', delta: 'down', detail: 'Setup incomplete' }) }

  // Outcome (highest positive weight).
  let outcome: number
  if (grace) outcome = GRACE_NEUTRAL
  else if (i.outcomes30d <= 0) { outcome = 20; f.push({ component: 'outcome', delta: 'down', detail: 'No business outcomes in 30d' }) }
  else if (i.outcomes30d >= i.outcomesPrev30d) { outcome = 100; f.push({ component: 'outcome', delta: 'up', detail: `${i.outcomes30d} outcomes (${trend(i.outcomes30d, i.outcomesPrev30d)})` }) }
  else { outcome = 50; f.push({ component: 'outcome', delta: 'down', detail: 'Outcomes declining' }) }

  // Usage.
  let usage: number
  if (grace) usage = GRACE_NEUTRAL
  else if (i.usage30d <= 0) { usage = 25; f.push({ component: 'usage', delta: 'down', detail: 'No usage in 30d' }) }
  else if (i.usage30d >= i.usagePrev30d) usage = 90
  else { usage = 45; f.push({ component: 'usage', delta: 'down', detail: 'Usage declining' }) }

  // Support (fewer unresolved = healthier).
  let support = 90
  if (i.unresolvedSupport > 0) { support = i.unresolvedSupport >= 3 ? 30 : 55; f.push({ component: 'support', delta: 'down', detail: `${i.unresolvedSupport} unresolved support items` }) }

  // Engagement (activity) — deliberately low-weight.
  let engagement: number
  if (grace) engagement = 70
  else if (i.lastActivityDays <= 7) engagement = 90
  else if (i.lastActivityDays <= 30) engagement = 55
  else { engagement = 25; f.push({ component: 'engagement', delta: 'down', detail: `No activity in ${i.lastActivityDays}d` }) }

  return { comp: { outcome, activation, billing, usage, support, engagement }, factors: f }
}

export function customerHealth(i: HealthInputs, w: HealthWeights = DEFAULT_HEALTH_WEIGHTS): HealthResult {
  const { comp, factors } = score(i)
  const totalW = (Object.values(w) as number[]).reduce((a, b) => a + b, 0) || 1
  let overall = ((Object.keys(comp) as HealthComponent[]).reduce((s, c) => s + comp[c] * (w[c] ?? 0), 0)) / totalW

  // Hard floors: a suspended account is Critical regardless of grace.
  if (i.suspended) overall = Math.min(overall, 20)

  const bucket: HealthBucket = overall >= 75 ? 'healthy' : overall >= 55 ? 'watch' : overall >= 35 ? 'at_risk' : 'critical'
  const worst = factors.filter((x) => x.delta === 'down').sort((a, b) => comp[a.component] - comp[b.component])[0]
  const recommendedAction = i.suspended ? 'Recover the account / confirm cancellation.'
    : worst?.component === 'billing' ? 'Recover the failed payment.'
    : worst?.component === 'activation' ? 'Drive the first business-value event (activation play).'
    : worst?.component === 'outcome' ? 'Investigate why outcomes stalled; re-engage the owner.'
    : worst?.component === 'support' ? 'Resolve the open support items.'
    : 'Maintain — monitor trend.'

  return {
    overall: Math.round(overall),
    bucket,
    components: (Object.keys(comp) as HealthComponent[]).map((c) => ({ component: c, score: comp[c] })),
    factors,
    recommendedAction,
  }
}
