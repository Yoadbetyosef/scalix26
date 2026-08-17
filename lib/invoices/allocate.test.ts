import { describe, it, expect } from 'vitest'
import { allocate, coverage, unitShare, type Charges } from './allocate'
// commissionPercent is 0 throughout: these allocate tests predate commission and are about the
// FREIGHT denominator, which commission does not touch. See cost-math.test.ts for the three-term
// golden vectors.
import { landedCost } from '@/lib/catalog/cost-math'

// The allocation decides what every product on a shipment costs, so the properties that matter are
// arithmetic ones: it must sum to exactly what was paid, it must rest only on lines someone actually
// identified, and it must give the same answer twice.

const line = (id: string, extended: number, status: 'matched' | 'unmatched' | 'skipped' = 'matched') =>
  ({ id, extended, status })

const charges = (freightTotal: number, dutiesTotal = 0, otherTotal = 0): Charges =>
  ({ freightTotal, dutiesTotal, otherTotal })

const totalAllocated = (a: { allocatedFreight: number; allocatedDuties: number }[]) =>
  a.reduce((s, x) => s + x.allocatedFreight + x.allocatedDuties, 0)

describe('the allocation sums to exactly what was paid', () => {
  it('splits an amount that does not divide evenly, without losing the cent', () => {
    // $100 across three equal lines is 33.333… each. Rounding all three down loses a cent, the
    // shipment stops reconciling against the invoice, and apply_shipment_costs refuses the write.
    const a = allocate(charges(100), [line('a', 10), line('b', 10), line('c', 10)])
    expect(a.map((x) => x.allocatedFreight)).toEqual([33.34, 33.33, 33.33])
    expect(totalAllocated(a)).toBe(100)
  })

  it('holds for an awkward split across unequal weights', () => {
    const a = allocate(charges(1000), [line('a', 100), line('b', 200)])
    expect(a.map((x) => x.allocatedFreight)).toEqual([333.33, 666.67])
    expect(totalAllocated(a)).toBe(1000)
  })

  it('holds for freight, duties and other charges together', () => {
    const a = allocate(charges(840.55, 219.4, 60.05), [line('a', 7), line('b', 11), line('c', 13)])
    // This is the guard apply_shipment_costs re-checks in SQL before it writes anything.
    expect(totalAllocated(a)).toBeCloseTo(840.55 + 219.4 + 60.05, 10)
  })

  it('keeps duty separate from freight, because customs asks for duty alone', () => {
    const a = allocate(charges(100, 50), [line('a', 10), line('b', 10)])
    expect(a[0]).toEqual({ lineId: 'a', allocatedFreight: 50, allocatedDuties: 25 })
  })

  it('folds handling and insurance in with freight rather than with duty', () => {
    const a = allocate(charges(100, 0, 20), [line('a', 10)])
    expect(a[0].allocatedFreight).toBe(120)
    expect(a[0].allocatedDuties).toBe(0)
  })
})

describe('only matched lines carry the shipment', () => {
  it('gives unmatched lines nothing and still spreads the whole charge', () => {
    const a = allocate(charges(300), [line('a', 100), line('b', 100, 'unmatched')])
    expect(a.find((x) => x.lineId === 'b')!.allocatedFreight).toBe(0)
    // The full 300 lands on the one matched line — not 150 with the rest evaporating.
    expect(totalAllocated(a)).toBe(300)
  })

  it('treats a line the owner skipped the same way as one we could not match', () => {
    const a = allocate(charges(300), [line('a', 100), line('b', 100, 'skipped')])
    expect(a.find((x) => x.lineId === 'b')!.allocatedFreight).toBe(0)
    expect(totalAllocated(a)).toBe(300)
  })

  it('returns a row for every line, so a previous share is always overwritten', () => {
    // A line that has just been un-matched must come back with zeros rather than being absent —
    // otherwise its old allocation survives in the database.
    const a = allocate(charges(100), [line('a', 10), line('b', 10, 'unmatched')])
    expect(a).toHaveLength(2)
    expect(a[1]).toEqual({ lineId: 'b', allocatedFreight: 0, allocatedDuties: 0 })
  })
})

describe('degenerate inputs produce zeros, never NaN', () => {
  it('allocates nothing when there are no charges', () => {
    const a = allocate(charges(0), [line('a', 10)])
    expect(totalAllocated(a)).toBe(0)
  })

  it('allocates nothing when every matched line is worth nothing', () => {
    // A zero-value invoice cannot be weighted by value. The guard is here so it yields 0 rather than
    // NaN; apply_shipment_costs refuses this case separately, with a message that names it.
    const a = allocate(charges(500), [line('a', 0), line('b', 0)])
    expect(a.every((x) => x.allocatedFreight === 0)).toBe(true)
  })

  it('allocates nothing when nothing is matched at all', () => {
    const a = allocate(charges(500), [line('a', 10, 'unmatched')])
    expect(totalAllocated(a)).toBe(0)
  })
})

describe('the same invoice allocates the same way twice', () => {
  it('breaks ties deterministically instead of by iteration accident', () => {
    // Identical weights mean identical fractional remainders. Something has to decide which line takes
    // the spare cent, and it must be the same something on the approval screen and on the apply.
    const lines = [line('a', 5), line('b', 5), line('c', 5), line('d', 5), line('e', 5), line('f', 5), line('g', 5)]
    const first = allocate(charges(10), lines)
    const second = allocate(charges(10), lines)
    expect(first).toEqual(second)
    expect(totalAllocated(first)).toBe(10)
  })
})

describe('coverage is what makes the matched-only denominator honest', () => {
  const lines = [
    line('a', 1000), line('b', 2000),
    line('c', 800, 'unmatched'), line('d', 200, 'skipped'),
  ]

  it('measures matched share by value, not by line count', () => {
    const c = coverage(lines)
    expect(c.totalValue).toBe(4000)
    expect(c.matchedValue).toBe(3000)
    expect(c.ratio).toBe(0.75)
  })

  it('counts what we could not match apart from what the owner excluded', () => {
    // One is a failure the owner can fix by matching; the other is a decision they already made.
    // Collapsing them would make a deliberate exclusion read as a defect.
    const c = coverage(lines)
    expect(c.unmatchedLines).toBe(1)
    expect(c.skippedLines).toBe(1)
    expect(c.unmatchedValue).toBe(800)
  })

  it('reports a zero ratio for an empty invoice rather than dividing by zero', () => {
    expect(coverage([]).ratio).toBe(0)
  })
})

// The rate itself is applied in SQL (apply_shipment_costs), but the arithmetic it implements is pinned
// here, because it is also what the review screen previews — and because the one thing that must never
// drift is WHICH figures the rate touches.
describe('a EUR invoice against a USD business', () => {
  const RATE = 1.08   // 1 EUR = 1.08 USD, typed by the owner off the invoice they paid

  it('converts the line value and leaves the freight alone', () => {
    // 2 units at 1,000 EUR each; the forwarder separately billed 150 USD freight and 50 USD duty.
    // Everything below is PER UNIT, because that is what product_costs holds.
    const a = allocate(charges(150, 50), [line('a', 2000)])
    const unitUsd = (2000 / 2) * RATE                    // 1,080 USD — the only thing converted
    const landed = landedCost({
      costPrimary: unitUsd,
      shippingCost: unitShare(a[0].allocatedFreight, 2),
      tariffCost: unitShare(a[0].allocatedDuties, 2),
      markupPercent: 10,
      commissionPercent: 0,
    })
    // (1080 + 75 + 25) x 1.1 = 1180 x 1.1
    expect(landed).toBeCloseTo(1298, 10)
  })

  it('produces a different, wrong number if freight is converted too', () => {
    // The mistake this guards against. Freight arrives from the forwarder ALREADY in USD, so
    // multiplying it by the invoice's rate corrupts a correct figure — silently, on the column the
    // whole feature exists to fill.
    const a = allocate(charges(150, 50), [line('a', 2000)])
    const f = unitShare(a[0].allocatedFreight, 2)
    const d = unitShare(a[0].allocatedDuties, 2)
    const right = landedCost({ costPrimary: 1000 * RATE, shippingCost: f, tariffCost: d, markupPercent: 10, commissionPercent: 0 })!
    const wrong = landedCost({ costPrimary: 1000 * RATE, shippingCost: f * RATE, tariffCost: d * RATE, markupPercent: 10, commissionPercent: 0 })!
    expect(wrong).toBeGreaterThan(right)
    expect(wrong - right).toBeCloseTo(100 * (RATE - 1) * 1.1, 10)
  })

  it('splits a USD freight pool identically whether the lines are priced in EUR or USD', () => {
    // Why the allocation needs no conversion at all: weights are RATIOS of line values, so the currency
    // cancels. A EUR-weighted split of a USD pool is a USD result.
    const eur = allocate(charges(1000), [line('a', 100), line('b', 300)])
    const usd = allocate(charges(1000), [line('a', 100 * RATE), line('b', 300 * RATE)])
    expect(eur.map((x) => x.allocatedFreight)).toEqual(usd.map((x) => x.allocatedFreight))
    expect(eur[0].allocatedFreight).toBe(250)
  })

  it('has no landed cost at all when the rate is missing', () => {
    // What the Apply guard exists to prevent: freight lands, cost_primary does not, and the product
    // ends up with a share of the shipment and no total or margin — with nothing on screen saying why.
    const a = allocate(charges(150, 50), [line('a', 2000)])
    expect(a[0].allocatedFreight).toBe(150)
    expect(landedCost({ costPrimary: null, shippingCost: unitShare(a[0].allocatedFreight, 2), tariffCost: unitShare(a[0].allocatedDuties, 2), markupPercent: 10, commissionPercent: 0 })).toBeNull()
  })
})

describe('what the owner sees on the approval screen', () => {
  it('predicts the landed cost the generated column will store', () => {
    // The end-to-end claim: a product bought at 1,000 that takes 150 of this shipment's freight and 50
    // of its duty lands at (1000 + 150 + 50) x 1.10. The approval preview computes this with the same
    // function the cost card uses, so the number it shows is the number the database will hold.
    const a = allocate(charges(150, 50), [line('a', 100)])
    expect(landedCost({ costPrimary: 1000, shippingCost: a[0].allocatedFreight, tariffCost: a[0].allocatedDuties, markupPercent: 10, commissionPercent: 0 })).toBe(1320)
  })

  it('leaves landed cost unknown when the purchase price was never recorded', () => {
    // Freight and duty still land; the total stays blank rather than implying the goods were free.
    const a = allocate(charges(150), [line('a', 100)])
    expect(a[0].allocatedFreight).toBe(150)
    expect(landedCost({ costPrimary: null, shippingCost: a[0].allocatedFreight, tariffCost: 0, markupPercent: 10, commissionPercent: 0 })).toBeNull()
  })
})

// The bug that shipped in phase 1 and was caught by working an expected answer out by hand rather than
// by any test: the allocation is a LINE total, product_costs is PER UNIT, and the two were being added
// together. See add_landed_cost_invoices_3.sql.
describe('the allocation is written per unit, not per line', () => {
  it('divides a line total by its quantity', () => {
    expect(unitShare(1454.55, 2)).toBeCloseTo(727.275, 10)
    expect(unitShare(290.91, 20)).toBeCloseTo(14.5455, 10)
  })

  it('treats a missing or zero quantity as one unit rather than dividing by zero', () => {
    expect(unitShare(150, null)).toBe(150)
    expect(unitShare(150, 0)).toBe(150)
  })

  it('overstates landed cost by the quantity if the line total is used directly', () => {
    // 20 cushions at 80 EUR taking 290.91 of freight. Per unit that is 14.55; using the line total
    // would put twentyfold the freight on every single cushion — plausible-looking, and wrong.
    const perUnit = landedCost({ costPrimary: 80, shippingCost: unitShare(290.91, 20), tariffCost: 0, markupPercent: 10, commissionPercent: 0 })!
    const perLine = landedCost({ costPrimary: 80, shippingCost: 290.91, tariffCost: 0, markupPercent: 10, commissionPercent: 0 })!
    expect(perUnit).toBeCloseTo(104.0, 1)
    expect(perLine).toBeCloseTo(408.0, 1)
    expect(perLine / perUnit).toBeGreaterThan(3.9)
  })
})
