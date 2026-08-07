import { describe, expect, it } from 'vitest'
import {
  DIVERGENCE_ABSOLUTE, DIVERGENCE_RELATIVE, assess, divergenceHeadline, divergenceSentence, projectCost, shapes,
} from './divergence'

// Every expected figure below was computed by hand from the landed-cost expression before the code was
// run against it. That is not ceremony: the per-unit bug in this feature survived two of its own tests
// because those tests were written from the implementation and inherited its denominator.

const base = {
  productId: 'p1',
  productName: 'RAJA sofa',
  priorQuantity: null,
  exchangeRate: 1,
}
const row = (costPrimary: number | null, shippingCost = 0, tariffCost = 0, markupPercent = 0) =>
  ({ costPrimary, shippingCost, tariffCost, markupPercent })
const next = (costPrimary: number, shippingCost = 0, tariffCost = 0, quantity = 1) =>
  ({ costPrimary, shippingCost, tariffCost, quantity })

describe('projectCost — mirrors the per_product CTE', () => {
  it('divides everything by the same quantity', () => {
    // 2 sofas at 4,000 taking 1,454.55 freight: 8,000/2 = 4,000 unit, 1,454.55/2 = 727.275 unit.
    const p = projectCost([{ extended: 8000, quantity: 2, allocatedFreight: 1454.55, allocatedDuties: 200 }], 1)
    expect(p.costPrimary).toBe(4000)
    expect(p.shippingCost).toBeCloseTo(727.275, 6)
    expect(p.tariffCost).toBe(100)
    expect(p.quantity).toBe(2)
  })

  it('treats a missing or zero quantity as one unit, like COALESCE(NULLIF(sum(qty),0),1)', () => {
    const p = projectCost([{ extended: 500, quantity: null, allocatedFreight: 50, allocatedDuties: 0 }], 1)
    expect(p.costPrimary).toBe(500)
    expect(p.shippingCost).toBe(50)
    expect(p.quantity).toBe(0)
  })

  it('converts the purchase price at the rate and leaves freight alone', () => {
    // Freight arrives from the forwarder already in base currency — add_landed_cost_invoices_2.sql.
    const p = projectCost([{ extended: 200, quantity: 20, allocatedFreight: 54.92, allocatedDuties: 0 }], 1.2)
    expect(p.costPrimary).toBeCloseTo(12, 6)
    expect(p.shippingCost).toBeCloseTo(2.746, 6)
  })

  it('sums several lines of one product before dividing', () => {
    const p = projectCost([
      { extended: 100, quantity: 5, allocatedFreight: 10, allocatedDuties: 0 },
      { extended: 300, quantity: 15, allocatedFreight: 30, allocatedDuties: 0 },
    ], 1)
    expect(p.costPrimary).toBe(20)
    expect(p.shippingCost).toBe(2)
  })
})

describe('assess — the silent cases', () => {
  it('says nothing when there is no cost row to overwrite', () => {
    expect(assess({ ...base, current: null, next: next(500), price: 900 })).toBeNull()
  })

  it('says nothing when the row exists but holds no purchase price', () => {
    expect(assess({ ...base, current: row(null, 3), next: next(500), price: 900 })).toBeNull()
  })

  it('says nothing about a reorder at a stable price — the wallpaper case', () => {
    // 400.00 → 408.00 is 2%, well inside FX drift and a different freight quote.
    expect(assess({ ...base, current: row(300, 100), next: next(308, 100), price: 900 })).toBeNull()
  })

  it('says nothing when the move is large in percent but small in money', () => {
    // A $2 fitting up 30% is $0.60. Cheap SKUs are most of the lines on a real invoice.
    const d = assess({ ...base, current: row(1.5, 0.5), next: next(2.1, 0.5), price: 6 })
    expect(d).toBeNull()
  })

  it('says nothing when the move is large in money but small in percent', () => {
    // $20 on a $400 sofa is 5%.
    expect(assess({ ...base, current: row(300, 100), next: next(320, 100), price: 900 })).toBeNull()
  })

  it('needs BOTH gates, so neither alone can be relaxed by accident', () => {
    expect(DIVERGENCE_RELATIVE).toBe(0.10)
    expect(DIVERGENCE_ABSOLUTE).toBe(5)
  })
})

describe('assess — the flag', () => {
  it('reports the margin collapse, not just the cost move', () => {
    // prev (10 + 2) x 1.1 = 13.20   next (14 + 3) x 1.1 = 18.70   delta 5.50 = +41.7%
    // margin at 25.00: (25 − 13.20)/25 = 47.2%  →  (25 − 18.70)/25 = 25.2%
    const d = assess({ ...base, current: row(10, 2, 0, 10), next: next(14, 3), price: 25 })!
    expect(d.previousCost).toBeCloseTo(13.2, 6)
    expect(d.nextCost).toBeCloseTo(18.7, 6)
    expect(d.delta).toBeCloseTo(5.5, 6)
    expect(d.deltaRelative).toBeCloseTo(0.41666, 4)
    expect(d.previousMargin).toBeCloseTo(47.2, 4)
    expect(d.nextMargin).toBeCloseTo(25.2, 4)
  })

  it('uses the row’s snapshotted markup on BOTH sides, never today’s default', () => {
    // The RPC leaves markup_percent alone on an existing row, so a markup change is not something the
    // apply causes and must not appear in the comparison.
    const d = assess({ ...base, current: row(100, 0, 0, 50), next: next(130), price: 400 })!
    expect(d.previousCost).toBeCloseTo(150, 6)
    expect(d.nextCost).toBeCloseTo(195, 6)
  })

  it('flags a cost DROP too — that is where a decimal slip downwards lives', () => {
    const d = assess({ ...base, current: row(100), next: next(60), price: 200 })!
    expect(d.delta).toBeCloseTo(-40, 6)
    expect(d.nextMargin!).toBeGreaterThan(d.previousMargin!)
    expect(divergenceSentence(d, 'USD')).toContain('margin rises')
  })
})

describe('assess — a product with no price', () => {
  it('makes no margin claim for a draft', () => {
    const d = assess({ ...base, current: row(100), next: next(140), price: null })!
    expect(d.price).toBeNull()
    expect(d.previousMargin).toBeNull()
    expect(d.nextMargin).toBeNull()
    const s = divergenceSentence(d, 'USD')
    expect(s).toContain('no selling price yet')
    expect(s).not.toContain('margin falls')
    expect(s).not.toMatch(/\d+% to/)
  })

  it('treats a price of zero as no price rather than dividing by it', () => {
    const d = assess({ ...base, current: row(100), next: next(140), price: 0 })!
    expect(d.price).toBeNull()
    expect(divergenceSentence(d, 'USD')).toContain('no margin to compare')
  })
})

describe('shapes — characterise, never classify', () => {
  it('finds nothing in an ordinary 40% rise', () => {
    expect(shapes(100, 140, 1, null, 1)).toEqual([])
  })

  it('names a decimal place', () => {
    const s = shapes(12, 120, 1, null, 1)
    expect(s).toHaveLength(1)
    expect(s[0].kind).toBe('decimal')
    expect(s[0].factor).toBe(10)
    expect(s[0].note).toContain('10×')
  })

  it('names a decimal place downwards', () => {
    expect(shapes(120, 12, 1, null, 1)[0]).toMatchObject({ kind: 'decimal', factor: 0.1 })
  })

  it('names the exchange rate', () => {
    const s = shapes(100, 120, 1.2, null, 1)
    expect(s).toHaveLength(1)
    expect(s[0].kind).toBe('currency')
    expect(s[0].note).toContain('1.2 exchange rate')
  })

  it('does not look for a currency shape on a base-currency invoice', () => {
    // Rate 1 would make every unchanged figure "the exchange rate".
    expect(shapes(100, 100, 1, null, 1)).toEqual([])
  })

  it('names a pack counted as a unit', () => {
    // 4 units at 25 last time; this invoice bills the pack of 4 as one line of 1 at 100.
    const s = shapes(25, 100, 1, 4, 1)
    expect(s).toHaveLength(1)
    expect(s[0].kind).toBe('pack')
    expect(s[0].note).toContain('4 → 1')
  })

  it('ignores a quantity change the unit cost did NOT follow', () => {
    // Ordering four times as many at the same unit price is not a pack error.
    expect(shapes(25, 25, 1, 4, 16)).toEqual([])
  })

  it('returns every shape that matches rather than picking one', () => {
    // A rate of 10 is also a decimal place. Choosing between them would be the guessing this refuses.
    const s = shapes(10, 100, 10, null, 1)
    expect(s.map((x) => x.kind).sort()).toEqual(['currency', 'decimal'])
  })

  it('never asserts which of the two figures is wrong', () => {
    const all = [...shapes(12, 120, 1, null, 1), ...shapes(100, 120, 1.2, null, 1), ...shapes(25, 100, 1, 4, 1)]
    expect(all).toHaveLength(3)
    for (const s of all) {
      expect(s.note).toMatch(/one of (them|these two)|these two/i)
      expect(s.note).not.toMatch(/is wrong|is incorrect|error in this/i)
    }
  })

  it('is silent when either figure is missing or zero', () => {
    expect(shapes(0, 100, 1, null, 1)).toEqual([])
    expect(shapes(100, 0, 1, null, 1)).toEqual([])
  })
})

describe('sentences', () => {
  it('makes the collapsed margin the subject', () => {
    const d = assess({ ...base, current: row(10, 2, 0, 10), next: next(14, 3), price: 25 })!
    expect(divergenceSentence(d, 'USD')).toBe(
      'RAJA sofa: margin falls from 47% to 25% — landed cost $13.20 → $18.70 (+42%).')
  })

  it('headlines a collapse as a collapse', () => {
    const d = assess({ ...base, current: row(10, 2, 0, 10), next: next(14, 3), price: 25 })!
    expect(divergenceHeadline([d])).toBe('Applying this shipment collapses a margin')
    expect(divergenceHeadline([d, { ...d, productId: 'p2' }])).toContain('2 products')
  })

  it('does not claim a collapse when nothing has a margin', () => {
    const d = assess({ ...base, current: row(100), next: next(140), price: null })!
    expect(divergenceHeadline([d])).toBe('Applying this shipment moves a cost materially')
  })
})
