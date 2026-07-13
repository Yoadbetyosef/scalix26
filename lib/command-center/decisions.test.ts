import { describe, it, expect } from 'vitest'
import { runForecast, blendedBasePriceCents } from './engine'
import { BASE_ASSUMPTIONS } from './defaults'
import { timeToTargetMonths } from './metrics'
import { computePriorities } from './priorities'
import { assembleEngines } from './engines'
import { simulate, applyDecisions } from './mission'
import { buildCeoBrief, buildAdvisorInput } from './brief'
import { playbookForEngine, PLAYBOOKS } from './playbooks'

const H = 24 // horizon months for meaningful (non-zero) snapshots
const IDX = 12

describe('CEO Priority Engine (deterministic, impact-ranked)', () => {
  it('flags low affiliate activation with a positive ARR-impact estimate + playbook', () => {
    const a = structuredClone(BASE_ASSUMPTIONS); a.affiliate.activationRate = 0.1
    const pr = computePriorities(runForecast(a, H), IDX)
    const aff = pr.find((p) => p.id === 'affiliate_activation')!
    expect(aff).toBeTruthy()
    expect(aff.estimatedArrImpactCents).toBeGreaterThan(0)
    expect(aff.playbookKey).toBe('affiliate_growth')
    expect(aff.recommendedAction).toMatch(/activation/i)
  })
  it('ranks a short runway as the single most critical item', () => {
    const a = structuredClone(BASE_ASSUMPTIONS); a.finance.openingCashCents = 0; a.opex.payrollMonthlyCents = 100_000_000
    const pr = computePriorities(runForecast(a, 3), 0)
    expect(pr[0].priority).toBe('critical')
    expect(pr[0].id).toBe('runway')
  })
  it('high churn produces a high-priority retention item', () => {
    const a = structuredClone(BASE_ASSUMPTIONS); a.retention.monthlyLogoChurn = 0.08
    const pr = computePriorities(runForecast(a, H), IDX)
    expect(pr.find((p) => p.id === 'churn')?.priority).toBe('high')
  })
})

describe('Engine object model', () => {
  it('assembles all four engines with playbook + forecast + bottleneck slots', () => {
    const engines = assembleEngines(runForecast(BASE_ASSUMPTIONS, H), IDX)
    expect(engines.map((e) => e.key)).toEqual(['direct', 'affiliate', 'whiteLabel', 'expansion'])
    for (const e of engines) {
      expect(e.forecast12).toHaveLength(12)
      expect(Array.isArray(e.bottlenecks)).toBe(true)
    }
    expect(engines.find((e) => e.key === 'affiliate')!.playbookKey).toBe('affiliate_growth')
    expect(playbookForEngine('whiteLabel')!.key).toBe('whitelabel_acquisition')
    expect(PLAYBOOKS.expansion.engine).toBe('expansion')
  })
})

describe('Mission Planner — decision simulator', () => {
  it('raising pricing 10% lifts ARR at the horizon', () => {
    const sim = simulate(BASE_ASSUMPTIONS, [{ kind: 'increasePricingPct', pct: 0.1 }], H, H)
    expect(sim.delta.arrCents.after).toBeGreaterThan(sim.delta.arrCents.before)
  })
  it('hiring sales reps raises payroll and customers', () => {
    const after = applyDecisions(BASE_ASSUMPTIONS, [{ kind: 'hireSalesReps', count: 2, salaryPerMonthCents: 900000 }])
    expect(after.direct.reps).toBe(BASE_ASSUMPTIONS.direct.reps + 2)
    expect(after.opex.payrollMonthlyCents).toBe(BASE_ASSUMPTIONS.opex.payrollMonthlyCents + 2 * 900000)
    const sim = simulate(BASE_ASSUMPTIONS, [{ kind: 'hireSalesReps', count: 2, salaryPerMonthCents: 900000 }], H, H)
    expect(sim.delta.customers.after).toBeGreaterThan(sim.delta.customers.before)
  })
  it('reducing churn increases customers', () => {
    const sim = simulate(BASE_ASSUMPTIONS, [{ kind: 'setMonthlyChurn', rate: 0.01 }], H, H)
    expect(sim.delta.customers.after).toBeGreaterThan(sim.delta.customers.before)
  })
  it('"increase ARPU to $X" scales the blended base price to the target', () => {
    const target = 65000 // $650
    const after = applyDecisions(BASE_ASSUMPTIONS, [{ kind: 'setBlendedPriceCents', cents: target }])
    expect(Math.abs(blendedBasePriceCents(after.mix, after.pricing) - target)).toBeLessThanOrEqual(2)
  })
})

describe('CEO Brief (four questions) + AI seam', () => {
  it('answers all four questions deterministically', () => {
    const brief = buildCeoBrief(runForecast(BASE_ASSUMPTIONS, H), IDX)
    expect(brief.source).toBe('deterministic')
    for (const s of [brief.whereAreWe, brief.whereGoing, brief.whatStopping, brief.whatNext]) expect(s.length).toBeGreaterThan(0)
    expect(brief.topPriorities.length).toBeLessThanOrEqual(3)
  })
  it('exposes the advisor input contract for a future AI producer', () => {
    const input = buildAdvisorInput(runForecast(BASE_ASSUMPTIONS, H), IDX)
    expect(input.northStar).toBeTruthy()
    expect(input.engines).toHaveLength(4)
    expect(Array.isArray(input.priorities)).toBe(true)
  })
})

describe('time to target', () => {
  it('returns null when the target ARR is not reached in the horizon', () => {
    const a = structuredClone(BASE_ASSUMPTIONS); a.targets.targetArrCents = 100_000_000_00 // $100M
    expect(timeToTargetMonths(runForecast(a, 12), a.targets.targetArrCents)).toBeNull()
  })
})
