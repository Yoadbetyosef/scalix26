import { describe, it, expect } from 'vitest'
import { toCents, toDollars } from './money'
import { BASE_ASSUMPTIONS, validatePlanMix } from './defaults'
import {
  blendedBasePriceCents, baseSubscriptionMrrCents, expansionMrrCents,
  affiliateCommissionCents, affiliateNetCents, valuationCents, runForecast,
} from './engine'

const P = BASE_ASSUMPTIONS.pricing

describe('golden-case formulas (spec cases 1–4)', () => {
  it('Case 1: 100 Growth @ $397, no add-ons/churn → base MRR $39,700', () => {
    const mix = { starterPct: 0, growthPct: 1, proPct: 0 }
    expect(blendedBasePriceCents(mix, P)).toBe(toCents(397))
    expect(baseSubscriptionMrrCents(100, mix, P)).toBe(toCents(39700))
    expect(toDollars(baseSubscriptionMrrCents(100, mix, P))).toBe(39700)
  })
  it('Case 2: 100 customers, 50% adopt one $97 add-on → expansion MRR $4,850', () => {
    expect(expansionMrrCents(100, 0.5, 1, toCents(97))).toBe(toCents(4850))
  })
  it('Case 3: $39,700 affiliate MRR @ 20% → $7,940 commission, $31,760 net', () => {
    const gross = toCents(39700)
    expect(affiliateCommissionCents(gross, 0.2)).toBe(toCents(7940))
    expect(affiliateNetCents(gross, 0.2)).toBe(toCents(31760))
  })
  it('Case 4: $100M ARR @ 10× → $1B valuation', () => {
    expect(toDollars(valuationCents(toCents(100_000_000), 10))).toBe(1_000_000_000)
  })
})

describe('plan-mix validation (must total 100%)', () => {
  it('accepts a mix summing to 100%', () => expect(validatePlanMix({ starterPct: 0.3, growthPct: 0.5, proPct: 0.2 })).toBeNull())
  it('rejects a mix that does not sum to 100%', () => expect(validatePlanMix({ starterPct: 0.3, growthPct: 0.3, proPct: 0.2 })).toMatch(/100%/))
})

describe('runForecast — deterministic 60-month engine', () => {
  it('produces 60 identical-on-rerun months, growing customers, valuation = ARR × multiple', () => {
    const a = runForecast(BASE_ASSUMPTIONS, 60)
    const b = runForecast(BASE_ASSUMPTIONS, 60)
    expect(a.months).toHaveLength(60)
    expect(a.months).toEqual(b.months) // deterministic
    expect(a.months[0].endCustomers).toBeGreaterThan(0)
    expect(a.months[59].endCustomers).toBeGreaterThan(a.months[0].endCustomers)
    expect(a.months[59].valuationCents).toBe(a.months[59].arrCents * BASE_ASSUMPTIONS.valuation.arrMultiple)
  })
  it('no churn + no adds → customers stay flat (no double-counting)', () => {
    const flat = structuredClone(BASE_ASSUMPTIONS)
    flat.retention.monthlyLogoChurn = 0
    flat.finance.startingCustomers = 100
    flat.direct = { ...flat.direct, reps: 0, paidBudgetCents: 0, organicLeadsPerMonth: 0, referralsPerMonth: 0 }
    flat.affiliate = { ...flat.affiliate, recruitedPerMonth: 0 }
    flat.whiteLabel = { ...flat.whiteLabel, agenciesPerMonth: 0 }
    expect(runForecast(flat, 12).months[11].endCustomers).toBe(100)
  })
})
