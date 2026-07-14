import { describe, it, expect } from 'vitest'
import { computePlan, type PlanInputs, type PlanConfig } from './plan'
import { enginePlans, directFunnel, affiliateFunnel, whiteLabelFunnel, expansionFunnel, type EngineRates, type EngineAllocation } from './plan-engines'

const NOW = Date.parse('2026-07-14T00:00:00.000Z')
const alloc: EngineAllocation = { direct: 0.45, affiliate: 0.35, whiteLabel: 0.20, expansion: 0 }
const rates: EngineRates = {
  direct: { closeRate: 0.25, showRate: 0.6, bookRate: 0.5, responseRate: 0.05 },
  affiliate: { customersPerActiveAffiliate: 2, activationRate: 0.4 },
  whiteLabel: { customersPerAgency: 5, launchRate: 0.5, closeRate: 0.3 },
  expansion: { adoptionRate: 0.2, avgAddOns: 1, addOnCents: 5000 }, arpuCents: 34700,
}
const cfg = (o: Partial<PlanConfig> = {}): PlanConfig => ({ primaryMetric: 'paying_customers', annualTarget: 120, startDate: '2026-01-01', targetDate: '2026-12-31', arpuTargetCents: null, monthlyGoalOverride: 40, allocation: alloc, ...o })
const inputs = (o: Partial<PlanInputs> = {}): PlanInputs => ({ config: cfg(), currentValue: 2, currentCustomers: 2, currentArpuCents: 34700, monthActual: 2, weekActual: 0, weekPrior: 0, engineRates: rates, riskActions: [], nowMs: NOW, ...o })

describe('Per-engine backward funnels (real rates; null = Input Required)', () => {
  it('direct: customers → demos → meetings → conversations → outreach', () => {
    expect(directFunnel(5, rates.direct)).toEqual({ customers: 5, demos: 20, meetings: 34, conversations: 68, outreach: 1360 })
    expect(directFunnel(5, { ...rates.direct, closeRate: 0 })).toBeNull()
  })
  it('affiliate: customers → productive → recruited', () => {
    expect(affiliateFunnel(4, rates.affiliate)).toEqual({ customers: 4, productiveAffiliates: 2, recruitedAffiliates: 5 })
    expect(affiliateFunnel(4, { ...rates.affiliate, activationRate: 0 })).toBeNull()
  })
  it('white label: customers → agencies → signed → meetings', () => {
    const w = whiteLabelFunnel(10, rates.whiteLabel)!
    expect(w.agencies).toBe(2); expect(w.signedAgencies).toBe(4); expect(w.meetings).toBe(14)
  })
  it('expansion: mrr → eligible offers', () => {
    expect(expansionFunnel(100000, rates.expansion)!.eligible).toBe(Math.ceil(100000 / (0.2 * 1 * 5000)))
    expect(expansionFunnel(100000, { ...rates.expansion, adoptionRate: 0 })).toBeNull()
  })
  it('allocation splits the customer gap and normalizes when not summing to 1', () => {
    const p = enginePlans(100, rates, { direct: 45, affiliate: 35, whiteLabel: 20, expansion: 0 })
    expect(p.direct.customers).toBe(45); expect(p.affiliate.customers).toBe(35); expect(p.whiteLabel.customers).toBe(20)
    expect(p.expansion.mrrCents).toBe(0)
  })
})

describe('Plan navigation cascade', () => {
  it('year: gap, progress, % behind plan', () => {
    const p = computePlan(inputs({ config: cfg({ primaryMetric: 'arr_cents', annualTarget: 100_000_000 }), currentValue: 800000 }))
    expect(p.year.gap).toBe(100_000_000 - 800000)
    expect(p.year.behindPct).toBeGreaterThan(0) // behind (little progress, half the year elapsed)
    expect(p.year.requiredCustomersCurrentArpu).toBe(Math.ceil(100_000_000 / (34700 * 12)))
  })
  it('month/week: derived from monthly override, days remaining, weekly requirement', () => {
    const p = computePlan(inputs())
    expect(p.month.requirement).toBe(40)
    expect(p.month.daysRemaining).toBe(17)
    expect(p.week.requirement).toBe(Math.ceil(40 / 4.345)) // 10
  })
  it('today: concrete cross-engine actions with why + gap impact', () => {
    const p = computePlan(inputs())
    const keys = p.today.map((a) => a.key)
    expect(keys).toContain('direct_outreach')
    expect(keys).toContain('direct_demos')
    expect(keys).toContain('affiliate_recruit')
    expect(keys).toContain('wl_meetings')
    expect(p.today[0].why).toBeTruthy()
    expect(p.today.find((a) => a.key === 'direct_outreach')!.expectedImpact).toMatch(/annual gap/)
  })
  it('missing a rate → Input Required for that engine, others still compute', () => {
    const p = computePlan(inputs({ engineRates: { ...rates, direct: { ...rates.direct, closeRate: 0 } } }))
    expect(p.today.find((a) => a.key === 'direct_input')).toBeTruthy()
    expect(p.today.find((a) => a.key === 'affiliate_recruit')).toBeTruthy()
  })
  it('risk actions are appended after the generated sales actions', () => {
    const risk = [{ key: 'at_risk', action: 'Review 2 at-risk customers', why: 'x', relatedGoal: 'Retention', expectedImpact: 'y' }]
    const p = computePlan(inputs({ riskActions: risk }))
    expect(p.today[p.today.length - 1].key).toBe('at_risk')
  })
})
