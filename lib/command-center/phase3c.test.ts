import { describe, it, expect } from 'vitest'
import { evaluateMilestone, requiredPathToArr, arrWaterfall, currentForMetric, type MissionCurrent, type MilestoneDef } from './mission-milestones'
import { computeGaps, sortByPriority, type WarRoomInput } from './war-room'

const current = (o: Partial<MissionCurrent> = {}): MissionCurrent => ({
  arrCents: 833_00 * 100 / 100 * 0, // placeholder overwritten below
  payingCustomers: 2, arpuCents: 34700, grossMargin: null, logoChurn: null, nrr: null,
  activeAffiliates: 0, producingAgencies: 2, onboardingCompletion: 0.4,
  directCustomers: 1, affiliateCustomers: 0, whiteLabelCustomers: 1,
  directMrrCents: 39700, affiliateMrrCents: 0, whiteLabelMrrCents: 29700, expansionMrrCents: 0, ...o,
})
const NOW = Date.parse('2026-07-14T00:00:00.000Z')
const def = (o: Partial<MilestoneDef>): MilestoneDef => ({ key: 'k', label: 'L', kind: 'arr', metricKey: 'arr_cents', targetValue: 100000000, targetDate: null, sortOrder: 0, ...o })

describe('Mission milestones (reality vs target; required path is Forecast/Estimate)', () => {
  it('marks achieved / behind / no_data and respects lower-is-better churn', () => {
    const c = current({ arrCents: 800000 })
    expect(evaluateMilestone(def({ metricKey: 'arr_cents', targetValue: 100000000 }), c, null, NOW).status).toBe('behind')
    expect(evaluateMilestone(def({ metricKey: 'paying_customers', targetValue: 1, kind: 'customers' }), c, null, NOW).achieved).toBe(true)
    expect(evaluateMilestone(def({ metricKey: 'nrr', targetValue: 1.1, kind: 'operational' }), c, null, NOW).status).toBe('no_data') // nrr null
    // logo churn: lower is better — current null → no_data; if 0.015 vs 0.02 target → achieved
    expect(evaluateMilestone(def({ metricKey: 'logo_churn', targetValue: 0.02, kind: 'operational' }), current({ logoChurn: 0.015 }), null, NOW).achieved).toBe(true)
    expect(evaluateMilestone(def({ metricKey: 'logo_churn', targetValue: 0.02, kind: 'operational' }), current({ logoChurn: 0.03 }), null, NOW).achieved).toBe(false)
  })

  it('computes forecast date from current growth and on_track vs behind', () => {
    const c = current({ arrCents: 1000000 }) // $10k ARR
    const m = evaluateMilestone(def({ metricKey: 'arr_cents', targetValue: 2000000, targetDate: '2027-07-14' }), c, 0.10, NOW) // 10% MoM → ~7.3 months to double
    expect(m.forecastDate).not.toBeNull()
    expect(m.requiredMonthlyGrowth).toBeGreaterThan(0)
    expect(m.status).toBe('on_track') // forecastDate well before 2027
  })

  it('required path decomposes ARR gap into customers, ARPU uplift and engine mix', () => {
    const c = current({ arrCents: 800000, payingCustomers: 2, arpuCents: 34700, directCustomers: 1, whiteLabelCustomers: 1, affiliateCustomers: 0 })
    const p = requiredPathToArr(500000000, c, NOW, '2028-07-14') // $5M ARR
    expect(p.arrGapCents).toBe(500000000 - 800000)
    expect(p.requiredCustomers).toBe(Math.ceil(500000000 / (34700 * 12)))
    expect(p.requiredNetNewCustomers).toBe(p.requiredCustomers - 2)
    expect(p.byEngine.direct + p.byEngine.affiliate + p.byEngine.whiteLabel).toBeGreaterThan(0)
    expect(p.requiredMonthlyGrowth).toBeGreaterThan(0)
  })

  it('ARR waterfall annualizes per-engine MRR', () => {
    const w = arrWaterfall(current({ directMrrCents: 39700, whiteLabelMrrCents: 29700, affiliateMrrCents: 0, expansionMrrCents: 0 }))
    expect(w.directCents).toBe(39700 * 12)
    expect(w.totalCents).toBe((39700 + 29700) * 12)
    expect(currentForMetric('arpu_cents', current({ arpuCents: 34700 }))).toBe(34700)
  })
})

describe('War Room gap generation (from real gaps only)', () => {
  const base: WarRoomInput = { activeTrials: 0, trialMrrOpportunityCents: 0, atRiskCount: 0, revenueAtRiskCents: 0, criticalCount: 0, activatedNotPaid: 0, activatedNotPaidMrrCents: 0, onboardingOutsideSla: 0, failedPayments: 0, failedPaymentMrrCents: 0, overloadedRoles: [] }

  it('no gaps when nothing is off-track (never fabricates work)', () => {
    expect(computeGaps(base)).toEqual([])
  })

  it('generates prioritized, deduped gaps with stable keys', () => {
    const gaps = computeGaps({ ...base, criticalCount: 1, atRiskCount: 7, revenueAtRiskCents: 100000, activeTrials: 20, trialMrrOpportunityCents: 794000, activatedNotPaid: 3, onboardingOutsideSla: 5, failedPayments: 2, overloadedRoles: [{ role: 'Support Rep', backlog: 12 }] })
    const keys = gaps.map((g) => g.gapKey)
    expect(keys).toContain('critical_health')
    expect(keys).toContain('failed_payments')
    expect(keys).toContain('at_risk')
    expect(keys).toContain('trial_conversion')
    expect(keys).toContain('capacity:Support Rep')
    // stable, unique keys (dedup anchor)
    expect(new Set(keys).size).toBe(keys.length)
    const sorted = sortByPriority(gaps)
    expect(['critical', 'critical']).toContain(sorted[0].priority) // criticals float to top
    expect(sorted[0].scope).toBe('today')
  })
})
