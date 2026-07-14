import { describe, it, expect } from 'vitest'
import { logoChurn, grossRevenueChurn, grossRevenueRetention, nrr, type RetentionPeriod } from './churn'
import { activationStatus, activationRate, type CustomerSignals } from './activation'
import { customerHealth, type HealthInputs } from './health'
import { observedStages, furthestObserved, buildFunnel } from './onboarding'
import { demandHours, utilization, supportLoad } from './support'
import { exclusionReason, countable, DEFAULT_EXCLUSIONS } from './exclusions'
import { confidenceFromCoverage, metric } from './sources'

describe('Churn / retention (golden + locked denominators)', () => {
  it('logo churn: 100 begin, 3 lost → 3%', () => {
    const p: RetentionPeriod = { beginningCustomers: 100, lostCustomers: 3, beginningMrrCents: 0, churnedMrrCents: 0, contractionMrrCents: 0, expansionMrrCents: 0 }
    expect(logoChurn(p)).toBeCloseTo(0.03, 6)
  })
  it('NRR: begin $100k, churn $5k, contraction $2k, expansion $8k → 101%', () => {
    const p: RetentionPeriod = { beginningCustomers: 0, lostCustomers: 0, beginningMrrCents: 10_000_000, churnedMrrCents: 500_000, contractionMrrCents: 200_000, expansionMrrCents: 800_000 }
    expect(nrr(p)).toBeCloseTo(1.01, 6)
    expect(grossRevenueChurn(p)).toBeCloseTo(0.07, 6)
    expect(grossRevenueRetention(p)).toBeCloseTo(0.93, 6)
  })
  it('NRR excludes new revenue: inputs are period-start only (no new-customer field exists)', () => {
    const p: RetentionPeriod = { beginningCustomers: 0, lostCustomers: 0, beginningMrrCents: 10_000_000, churnedMrrCents: 0, contractionMrrCents: 0, expansionMrrCents: 0 }
    expect(nrr(p)).toBe(1) // flat — new customers can't inflate it
  })
})

describe('Activation / adoption', () => {
  const iso = (d: string) => new Date(d + 'T12:00:00Z').toISOString()
  it('activation rate: 40 started, 30 activated → 75%', () => {
    const customers = [...Array(30).fill({ activated: true }), ...Array(10).fill({ activated: false })]
    expect(activationRate(customers)).toBe(0.75)
  })
  it('activated requires a value event; login/setup alone does not', () => {
    const s: CustomerSignals = { requiredOnboardingComplete: true, liveChannels: 1, valueEvents: [] }
    expect(activationStatus(s).activated).toBe(false)
    expect(activationStatus(s).setupComplete).toBe(true)
    expect(activationStatus(s).technicallyLive).toBe(true)
  })
  it('adopted needs ≥3 events across ≥2 days within 30d', () => {
    const two = activationStatus({ requiredOnboardingComplete: true, liveChannels: 1, valueEvents: [
      { type: 'lead', at: iso('2026-07-01') }, { type: 'lead', at: iso('2026-07-01') }, { type: 'appointment', at: iso('2026-07-01') }] })
    expect(two.activated).toBe(true); expect(two.adopted).toBe(false) // all same day
    const spread = activationStatus({ requiredOnboardingComplete: true, liveChannels: 1, valueEvents: [
      { type: 'lead', at: iso('2026-07-01') }, { type: 'lead', at: iso('2026-07-03') }, { type: 'appointment', at: iso('2026-07-10') }] })
    expect(spread.adopted).toBe(true)
  })
})

describe('Customer health (lifecycle-aware, explainable)', () => {
  const base: HealthInputs = { lifecycle: 'established', daysSinceSignup: 90, setupComplete: true, activated: true, adopted: true,
    outcomes30d: 10, outcomesPrev30d: 8, usage30d: 50, usagePrev30d: 40, openSupport: 0, unresolvedSupport: 0, billingFailed: false, suspended: false, lastActivityDays: 2 }
  it('a healthy established customer scores high', () => {
    const h = customerHealth(base); expect(h.bucket).toBe('healthy'); expect(h.overall).toBeGreaterThanOrEqual(85)
  })
  it('a brand-new onboarding customer with no usage is NOT critical (grace)', () => {
    const h = customerHealth({ ...base, lifecycle: 'onboarding', daysSinceSignup: 3, setupComplete: false, activated: false, adopted: false, outcomes30d: 0, outcomesPrev30d: 0, usage30d: 0, usagePrev30d: 0, lastActivityDays: 1 })
    expect(h.bucket).not.toBe('critical'); expect(h.bucket).not.toBe('at_risk')
  })
  it('a suspended account is critical regardless', () => {
    expect(customerHealth({ ...base, suspended: true }).bucket).toBe('critical')
  })
  it('billing failure + no outcomes drops an established customer to risk', () => {
    const h = customerHealth({ ...base, billingFailed: true, outcomes30d: 0, usage30d: 0, lastActivityDays: 40 })
    expect(['at_risk', 'critical']).toContain(h.bucket)
    expect(h.factors.some((f) => f.component === 'billing' && f.delta === 'down')).toBe(true)
    expect(h.recommendedAction).toMatch(/payment/i)
  })
})

describe('Onboarding funnel (observed vs unknown — never faked)', () => {
  it('sparse checklist → setup_complete is unknown, not assumed', () => {
    const st = observedStages({ hasSubscription: true, requiredStepsComplete: null, liveChannels: 0, activated: true, adopted: false })
    expect(st.setup_complete).toBe('unknown')
    expect(st.payment_complete).toBe('done')      // subscription proves payment
    expect(st.technically_live).toBe('done')       // activation guarantees a live channel
    expect(furthestObserved({ hasSubscription: true, requiredStepsComplete: null, liveChannels: 0, activated: true, adopted: false })).toBe('activated')
  })
  it('no proof → furthest observed is only signed_up', () => {
    expect(furthestObserved({ hasSubscription: false, requiredStepsComplete: null, liveChannels: 0, activated: false, adopted: false })).toBe('signed_up')
  })
  it('funnel: 40 customers, 30 activated', () => {
    const custs = [...Array(30).fill({ hasSubscription: true, requiredStepsComplete: null, liveChannels: 1, activated: true, adopted: false }),
      ...Array(10).fill({ hasSubscription: true, requiredStepsComplete: null, liveChannels: 0, activated: false, adopted: false })]
    const f = buildFunnel(custs)
    expect(f.total).toBe(40)
    expect(f.cells.find((c) => c.stage === 'activated')!.done).toBe(30)
    expect(f.unknownStages).toContain('setup_complete') // honestly flagged
  })
})

describe('Support proxy (golden)', () => {
  it('80 requests × 30 min = 40 demand hours', () => expect(demandHours({ requests: 80, avgHandlingMinutes: 30 })).toBe(40))
  it('90h demand / 120h available = 75% utilization', () => expect(utilization(90, 120)).toBe(0.75))
  it('supportLoad flags a needed hire when overloaded', () => {
    const load = supportLoad({ requests: 300, avgHandlingMinutes: 30 }, { headcount: 1, productiveHoursEachPerPeriod: 120, utilizationTarget: 0.8 })
    expect(load.nextHireNeeded).toBe(true)
  })
})

describe('Exclusions + source classification', () => {
  it('excludes test / internal / free tenants with a reason', () => {
    expect(exclusionReason({ id: '1', business_name: 'ZZ_Test Co', plan: 'pro' }, DEFAULT_EXCLUSIONS)).toMatch(/test/)
    expect(exclusionReason({ id: '2', email: 'me@scalix26.com', plan: 'pro' }, DEFAULT_EXCLUSIONS)).toMatch(/internal/)
    expect(exclusionReason({ id: '3', plan: 'free' }, DEFAULT_EXCLUSIONS)).toMatch(/free/)
    expect(exclusionReason({ id: '4', business_name: 'Real Biz', email: 'a@real.com', plan: 'pro' }, DEFAULT_EXCLUSIONS)).toBeNull()
    expect(countable([{ id: '1', business_name: 'ZZ_x' }, { id: '4', business_name: 'Real', email: 'a@real.com', plan: 'pro' }], DEFAULT_EXCLUSIONS)).toHaveLength(1)
  })
  it('confidence tracks coverage; a null metric is Manual with no confidence', () => {
    expect(confidenceFromCoverage(0.9)).toBe('high')
    expect(confidenceFromCoverage(0.4)).toBe('low')
    expect(metric(null, 'manual').confidence).toBe('none')
    expect(metric(42, 'derived_actual', { coverage: 0.41 }).confidence).toBe('low')
  })
})
