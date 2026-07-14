import { describe, it, expect } from 'vitest'
import { summarizeCosts, monthlyCents, isActive, type CostItem } from './costs'
import { unitEconomics, segmentEconomics } from './unit-economics'

const cost = (o: Partial<CostItem>): CostItem => ({ id: 'c', costType: 'cogs', category: 'voice', vendor: null, amountCents: 10000, recurrence: 'monthly', startDate: '2026-01-01', endDate: null, notes: null, owner: null, sourceClassification: 'manual', updatedBy: null, updatedAt: null, ...o })
const NOW = '2026-07-14T00:00:00.000Z'

describe('Costs (monthly run-rate; one-time excluded from recurring)', () => {
  it('normalizes recurrence to monthly and excludes one-time from the run-rate', () => {
    expect(monthlyCents({ amountCents: 12000, recurrence: 'monthly' })).toBe(12000)
    expect(monthlyCents({ amountCents: 12000, recurrence: 'annual' })).toBe(1000)
    expect(monthlyCents({ amountCents: 12000, recurrence: 'one_time' })).toBe(0)
  })
  it('respects active window and aggregates by type + category', () => {
    expect(isActive({ startDate: '2026-08-01', endDate: null }, NOW)).toBe(false) // future
    expect(isActive({ startDate: '2026-01-01', endDate: '2026-06-30' }, NOW)).toBe(false) // ended
    const s = summarizeCosts([
      cost({ costType: 'cogs', category: 'voice', amountCents: 50000 }),
      cost({ costType: 'cogs', category: 'sms', amountCents: 20000 }),
      cost({ costType: 'opex', category: 'payroll', amountCents: 800000 }),
      cost({ costType: 'opex', category: 'ads', amountCents: 120000, recurrence: 'annual' }),
      cost({ costType: 'opex', category: 'legal', amountCents: 500000, recurrence: 'one_time' }),
      cost({ costType: 'cogs', category: 'voice', amountCents: 99999, startDate: '2027-01-01' }), // not active
    ], NOW)
    expect(s.monthlyCogsCents).toBe(70000)          // 50k + 20k (future one excluded)
    expect(s.monthlyOpexCents).toBe(800000 + 10000) // payroll + annual/12
    expect(s.oneTimeActiveCents).toBe(500000)
    expect(s.monthlyTotalCents).toBe(880000)
    expect(s.byCategory[0].category).toBe('payroll') // largest first
  })
})

describe('Unit economics (reality where computable, else null/Waiting)', () => {
  it('ARPU is derived; gross margin needs COGS', () => {
    expect(unitEconomics({ mrrCents: 69400, payingCustomers: 2, monthlyCogsCents: null }).arpuCents).toBe(34700)
    expect(unitEconomics({ mrrCents: 69400, payingCustomers: 2, monthlyCogsCents: null }).grossMarginPct).toBeNull()
    const e = unitEconomics({ mrrCents: 100000, payingCustomers: 4, monthlyCogsCents: 25000 })
    expect(e.grossMarginPct).toBeCloseTo(0.75, 6)
    expect(e.costToServeCents).toBe(6250)
    expect(e.contributionPerCustomerCents).toBe(25000 - 6250)
  })
  it('segment economics compute ARPU and revenue share', () => {
    const segs = segmentEconomics([{ key: 'direct', label: 'Direct', customers: 1, mrrCents: 39700 }, { key: 'wl', label: 'WL', customers: 1, mrrCents: 29700 }])
    expect(segs[0].arpuCents).toBe(39700)
    expect(segs[0].sharePct).toBeCloseTo(39700 / 69400, 6)
  })
})
