import { describe, it, expect } from 'vitest'
import { runForecast } from './engine'
import { BASE_ASSUMPTIONS } from './defaults'
import { northStar, engineSnapshots } from './metrics'
import { detectBottlenecks } from './insights'
import { capacityPlan, totalRequiredHeadcount } from './capacity'
import { founderAccessAllowed } from './guard'

describe('North Star + engine snapshots', () => {
  const f = runForecast(BASE_ASSUMPTIONS, 12)
  it('exposes valuation progress toward target', () => {
    const ns = northStar(f, 11)
    expect(ns.customers).toBeGreaterThan(0)
    expect(ns.valuationCents).toBe(f.months[11].valuationCents)
    expect(ns.progressToTargetPct).toBeGreaterThanOrEqual(0)
  })
  it('returns the four engines each with a health color', () => {
    const snaps = engineSnapshots(f, 11)
    expect(snaps.map((s) => s.key)).toEqual(['direct', 'affiliate', 'whiteLabel', 'expansion'])
    snaps.forEach((s) => expect(['green', 'yellow', 'red']).toContain(s.health))
  })
})

describe('Bottleneck detector (deterministic)', () => {
  it('ranks a short runway as the top (high-severity) constraint', () => {
    const a = structuredClone(BASE_ASSUMPTIONS)
    a.finance.openingCashCents = 0
    a.opex.payrollMonthlyCents = 100_000_000 // $1M/mo → guaranteed burn
    const ins = detectBottlenecks(runForecast(a, 3), 0)
    expect(ins[0].severity).toBe('high')
    expect(ins.some((i) => i.id === 'runway')).toBe(true)
  })
  it('flags low affiliate activation', () => {
    const a = structuredClone(BASE_ASSUMPTIONS)
    a.affiliate.activationRate = 0.1
    expect(detectBottlenecks(runForecast(a, 1), 0).some((i) => i.id === 'affiliate_activation')).toBe(true)
  })
})

describe('Capacity planner (deterministic thresholds)', () => {
  it('100 customers → 1 Support Rep, no CSM yet', () => {
    const plan = capacityPlan(100)
    expect(plan.find((p) => p.role === 'Support Rep')!.required).toBe(1)
    expect(plan.find((p) => p.role === 'Customer Success Manager')!.required).toBe(0)
  })
  it('500 customers → a Customer Success Manager is required', () => {
    expect(capacityPlan(500).find((p) => p.role === 'Customer Success Manager')!.required).toBeGreaterThanOrEqual(1)
  })
  it('total required headcount grows with customer count', () => {
    expect(totalRequiredHeadcount(1000)).toBeGreaterThan(totalRequiredHeadcount(100))
  })
})

describe('Access control (pure predicate)', () => {
  it('requires BOTH the flag enabled AND a founder email', () => {
    expect(founderAccessAllowed({ enabled: true, email: 'yoadbetyosef@gmail.com' })).toBe(true)
    expect(founderAccessAllowed({ enabled: false, email: 'yoadbetyosef@gmail.com' })).toBe(false) // flag off
    expect(founderAccessAllowed({ enabled: true, email: 'support@scalix26.com' })).toBe(false) // not founder
    expect(founderAccessAllowed({ enabled: true, email: null })).toBe(false)
  })
})
