import { describe, it, expect } from 'vitest'
import { computePlan, FEASIBILITY_LEVERS, type PlanInputs, type PlanConfig, type EngineCapacity } from './plan'
import { directFunnel, affiliateFunnel, whiteLabelFunnel, expansionFunnel, enginePlans, type EngineRates } from './plan-engines'
import type { WorkCalendar } from './plan-calendar'

const WED = Date.parse('2026-07-15T16:00:00.000Z') // Wed July 15 (NY)
const FRI = Date.parse('2026-07-17T16:00:00.000Z') // Fri July 17 (NY)
const NY = 'America/New_York'
const calN = (wd: number): WorkCalendar => ({ timezone: NY, weekStartDay: 1, workingDaysPerWeek: wd })
const rates: EngineRates = {
  direct: { closeRate: 0.25, showRate: 0.6, bookRate: 0.5, responseRate: 0.05 },
  affiliate: { customersPerActiveAffiliate: 2, activationRate: 0.4 },
  whiteLabel: { customersPerAgency: 5, launchRate: 0.5, closeRate: 0.3 },
  expansion: { adoptionRate: 0.2, avgAddOns: 1, addOnCents: 5000 }, arpuCents: 34700,
}
const cfg = (wd: number): PlanConfig => ({ primaryMetric: 'paying_customers', annualTarget: 1200, startDate: '2026-01-01', targetDate: '2026-12-31', arpuTargetCents: null, monthlyGoalOverride: 40, allocation: { direct: 1, affiliate: 0, whiteLabel: 0, expansion: 0 }, calendar: calN(wd) })
const inputs = (o: Partial<PlanInputs> = {}, wd = 7): PlanInputs => ({ config: cfg(wd), currentValue: 2, currentCustomers: 2, currentArpuCents: 34700, monthActual: 0, weekActual: 0, weekPrior: 0, engineRates: rates, capacity: { directOutreachPerDay: null }, riskActions: [], nowMs: WED, ...o })
const outreachAction = (p: ReturnType<typeof computePlan>) => p.today.find((a) => a.key === 'direct_outreach')!

describe('Per-engine backward funnels (unchanged core)', () => {
  it('direct/affiliate/whiteLabel/expansion still back-calc from real rates', () => {
    expect(directFunnel(5, rates.direct)).toEqual({ customers: 5, demos: 20, meetings: 34, conversations: 68, outreach: 1360 })
    expect(affiliateFunnel(4, rates.affiliate)!.recruitedAffiliates).toBe(5)
    expect(whiteLabelFunnel(10, rates.whiteLabel)!.meetings).toBe(14)
    expect(expansionFunnel(100000, rates.expansion)!.eligible).toBe(100)
    expect(enginePlans(100, rates, { direct: 45, affiliate: 35, whiteLabel: 20, expansion: 0 }).direct.customers).toBe(45)
  })
})

describe('Working-days daily pace (no hardcoded divisor)', () => {
  it('5-day vs 7-day workweeks produce different daily targets', () => {
    const p7 = outreachAction(computePlan(inputs({}, 7)))
    const p5 = outreachAction(computePlan(inputs({ config: cfg(5) }, 5)))
    expect(p7.dailyTarget).not.toBe(p5.dailyTarget)      // divisor is dynamic, not a constant 5
    expect(p5.dailyTarget!).toBeGreaterThan(p7.dailyTarget!) // fewer working days → higher daily pace
  })

  it('1-day workweek on a non-working day → rest day, no sales actions', () => {
    const p = computePlan(inputs({}, 1)) // only Monday works; today is Wed
    expect(p.isWorkingDay).toBe(false)
    expect(p.today.some((a) => a.key === 'rest_day')).toBe(true)
    expect(p.today.some((a) => a.key === 'direct_outreach')).toBe(false)
  })

  it('remaining-working-days redistribution: later in the week → higher daily pace', () => {
    const wed = outreachAction(computePlan(inputs({ nowMs: WED }, 7))) // 5 working days left
    const fri = outreachAction(computePlan(inputs({ nowMs: FRI }, 7))) // 3 working days left
    expect(fri.dailyTarget!).toBeGreaterThan(wed.dailyTarget!)
  })

  it('skipped day (behind) increases pace; ahead-of-plan reduces it', () => {
    const behind = outreachAction(computePlan(inputs({ weekActual: 0 })))
    const ahead = outreachAction(computePlan(inputs({ weekActual: 9 })))
    expect(ahead.dailyTarget!).toBeLessThan(behind.dailyTarget!)
  })

  it('rounding: exact fractional pace kept; concrete target rounded up', () => {
    const a = outreachAction(computePlan(inputs()))
    expect(a.dailyTarget).toBe(Math.ceil(a.exactDailyPace!))
    expect(a.calc!.some((s) => /Exact daily pace/.test(s.label))).toBe(true)     // exact shown
    expect(a.calc!.some((s) => /Remaining working days/.test(s.label))).toBe(true)
  })

  it('every daily action explains the calculation from persisted assumptions', () => {
    const a = outreachAction(computePlan(inputs()))
    const labels = a.calc!.map((s) => s.label)
    expect(labels).toEqual(expect.arrayContaining(['Direct customers / week', 'Close rate', 'Required demos / week', 'Required outreach / week', 'Remaining working days this week']))
  })
})

describe('Required pace vs team capacity (feasible vs mathematically required)', () => {
  it('flags not-operationally-feasible with a capacity gap and levers', () => {
    const a = outreachAction(computePlan(inputs({ capacity: { directOutreachPerDay: 50 } as EngineCapacity })))
    expect(a.feasible).toBe(false)
    expect(a.capacityGapPerDay!).toBeGreaterThan(0)
    expect(a.levers).toEqual(FEASIBILITY_LEVERS)
  })
  it('marks feasible when capacity covers the required daily pace', () => {
    const a = outreachAction(computePlan(inputs({ capacity: { directOutreachPerDay: 1_000_000 } as EngineCapacity })))
    expect(a.feasible).toBe(true)
    expect(a.capacityGapPerDay).toBe(0)
  })
  it('capacity unknown (not configured) → feasibility null, never a false claim', () => {
    const a = outreachAction(computePlan(inputs({ capacity: { directOutreachPerDay: null } })))
    expect(a.feasible).toBeNull()
  })
})
