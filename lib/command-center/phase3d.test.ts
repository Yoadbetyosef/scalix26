import { describe, it, expect } from 'vitest'
import { requiredActivity, expansionGroups, buildFunnel, ENGINE_PLAYBOOKS } from './growth-engines'
import type { CustomerModel } from './adapters'

const cm = (o: Partial<CustomerModel>): CustomerModel => ({ id: 'x', name: 'X', engine: 'direct', planPriceCents: 29700, lifecycle: 'established', activated: true, adopted: false, setupComplete: true, healthOverall: 70, healthBucket: 'healthy', onboarding: {}, observedStage: 'activated', outcomes30d: 0, daysSinceSignup: 40, isTrial: false, converted: true, expired: false, ...o })

describe('Growth engines (reality output; waiting-for-data honest funnels)', () => {
  it('backward-calc required activity from a target + horizon (Estimate); nulls when no target', () => {
    expect(requiredActivity(2, null, 12)).toEqual({ targetCustomers: null, gapCustomers: null, requiredMonthly: null })
    const r = requiredActivity(100, 700, 10)
    expect(r.gapCustomers).toBe(600)
    expect(r.requiredMonthly).toBe(60)
    expect(requiredActivity(100, 700, null).requiredMonthly).toBeNull() // no horizon → no monthly rate
  })

  it('un-instrumented funnel steps are Waiting for Data, never fabricated', () => {
    const f = buildFunnel(ENGINE_PLAYBOOKS.direct, { trials: 20, paying: 2 })
    const outreach = f.find((s) => s.key === 'outreach')!
    const paying = f.find((s) => s.key === 'paying')!
    expect(outreach.value).toBeNull()
    expect(outreach.source).toBe('waiting')
    expect(paying.value).toBe(2)
    expect(paying.source).toBe('derived_actual')
  })

  it('expansion opportunity groups are deterministic from real models (no offers auto-sent)', () => {
    const models = [
      cm({ adopted: true, planPriceCents: 29700 }),               // adopted low plan → upgrade
      cm({ activated: true, adopted: false }),                    // activated not adopted
      cm({ outcomes30d: 15, planPriceCents: 29700, adopted: true }), // high activity low plan (also adopted low)
      cm({ isTrial: true, converted: false }),                    // trial → excluded from paying groups
    ]
    const g = expansionGroups(models)
    const byKey = Object.fromEntries(g.map((x) => [x.key, x]))
    expect(byKey['adopted_low_plan'].count).toBe(2)        // two adopted on low plan
    expect(byKey['adopted_low_plan'].potentialMrrCents).toBe(2 * 10000)
    expect(byKey['activated_not_adopted'].count).toBe(1)
    expect(byKey['high_activity_low_plan'].count).toBe(1)
    expect(g.every((x) => x.count > 0)).toBe(true)         // empty groups filtered out
  })
})
