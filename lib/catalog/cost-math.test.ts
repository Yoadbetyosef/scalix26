import { describe, expect, it } from 'vitest'
import { commissionAmount, goodsWithCommission, landedCost, margin, markupAmount, subtotalBeforeMarkup } from './cost-math'

// ── GOLDEN VECTORS ──────────────────────────────────────────────────────────────────────────────────
//
// This file is a MIRROR of the generated column product_costs.computed_cost, and the two can only be
// kept honest by pinning values that were computed independently of both. Every number below was
// worked out by hand, or read off a production row before this code existed.
//
// If a change to the SQL expression is not matched here, these fail. That is the whole point: the
// SQL/TS duplication cannot be removed (a generated column cannot call TypeScript), only defended.

const c = (costPrimary: number | null, shippingCost = 0, tariffCost = 0, markupPercent = 0, commissionPercent = 0) =>
  ({ costPrimary, shippingCost, tariffCost, markupPercent, commissionPercent })

describe('golden vectors', () => {
  it('the brief’s worked example: 100 cost, 20 shipping, 25% commission, 10% markup', () => {
    // (100 * 1.25 + 20) * 1.10 = 145 * 1.10 = 159.50
    expect(landedCost(c(100, 20, 0, 10, 25))).toBeCloseTo(159.5, 10)
  })

  it('is NOT commission applied to the whole sum', () => {
    // The wrong answer, written down so nobody rediscovers it: (100 + 20) * 1.25 * 1.10 = 165.00
    expect(landedCost(c(100, 20, 0, 10, 25))).not.toBeCloseTo(165, 2)
  })

  it('commission does not touch shipping or duty', () => {
    // Same goods, freight moved from shipping to duty: the commission portion cannot change.
    expect(commissionAmount(c(100, 20, 0, 10, 25))).toBe(25)
    expect(commissionAmount(c(100, 0, 20, 10, 25))).toBe(25)
    expect(commissionAmount(c(100, 500, 300, 10, 25))).toBe(25)
  })

  it('reproduces a real production row at commission 0', () => {
    // product_costs, YDC, PRIMAVERA 866/4/2026, read 7 Aug 2026:
    //   cost_primary 12.00, shipping_cost 2.746, tariff 0, markup 10 -> computed_cost 16.2206
    expect(landedCost(c(12, 2.746, 0, 10, 0))).toBeCloseTo(16.2206, 10)
  })

  it('reproduces that same row after the 25% backfill', () => {
    // (12 * 1.25 + 2.746) * 1.10 = 17.746 * 1.10 = 19.5206  — a +20.34% move
    const before = landedCost(c(12, 2.746, 0, 10, 0))!
    const after = landedCost(c(12, 2.746, 0, 10, 25))!
    expect(after).toBeCloseTo(19.5206, 10)
    // 0.25 * 12 / (12 + 2.746) = 20.3445%. The neighbouring cushion rows carry shipping 2.745 and
    // move 20.3459% — one cent of largest-remainder freight rounding apart. That hundredth of a
    // percentage point IS the whole spread across the 126, and it is arithmetic, not bad input.
    expect(((after - before) / before) * 100).toBeCloseTo(20.3445, 3)
    expect(((landedCost(c(12, 2.745, 0, 10, 25))! - landedCost(c(12, 2.745, 0, 10, 0))!) / landedCost(c(12, 2.745, 0, 10, 0))!) * 100)
      .toBeCloseTo(20.3459, 3)
  })

  it('commission at 0 is exactly the old two-term formula', () => {
    // Why the migration can drop and re-add the generated column without moving a single existing row.
    for (const [cp, s, t, m] of [[12, 2.746, 0, 10], [832.8, 190.58, 0, 10], [1000, 0, 55, 25]]) {
      expect(landedCost(c(cp, s, t, m, 0))).toBeCloseTo((cp + s + t) * (1 + m / 100), 10)
    }
  })
})

describe('the parts add up to the whole', () => {
  it('goods + commission + shipping + tariff + markup = landed cost', () => {
    const x = c(100, 20, 15, 10, 25)
    expect(x.costPrimary! + commissionAmount(x)! + x.shippingCost + x.tariffCost).toBeCloseTo(subtotalBeforeMarkup(x)!, 10)
    expect(subtotalBeforeMarkup(x)! + markupAmount(x)!).toBeCloseTo(landedCost(x)!, 10)
  })

  it('is what the cost card reads down, in order', () => {
    // Product cost 100.00 / commission 25.00 / shipping+duty 20.00 / subtotal 145.00 / markup 14.50
    const x = c(100, 20, 0, 10, 25)
    expect(goodsWithCommission(x)).toBe(125)
    expect(subtotalBeforeMarkup(x)).toBe(145)
    expect(markupAmount(x)).toBeCloseTo(14.5, 10)
    expect(landedCost(x)).toBeCloseTo(159.5, 10)
  })
})

describe('null in, null out', () => {
  it('every figure is null when the purchase price is unknown', () => {
    const x = c(null, 150, 20, 10, 25)
    expect(landedCost(x)).toBeNull()
    expect(markupAmount(x)).toBeNull()
    expect(commissionAmount(x)).toBeNull()
    expect(goodsWithCommission(x)).toBeNull()
    expect(subtotalBeforeMarkup(x)).toBeNull()
  })

  it('a cost of 0 is a number, not an absence', () => {
    // The two B&N "SET OF CUSHIONS" rows: bundled into the chair's price, invoiced at 0.00. The
    // arithmetic is honest; whether such a line should be a product at all is logged in OUTSTANDING.
    expect(landedCost(c(0, 0, 0, 10, 25))).toBe(0)
    expect(margin(0, 0)).toBeNull()
  })
})

describe('margin', () => {
  it('falls when commission is added and the price does not move', () => {
    const before = landedCost(c(100, 20, 0, 10, 0))!
    const after = landedCost(c(100, 20, 0, 10, 25))!
    expect(margin(200, before)).toBeCloseTo(34, 4)
    expect(margin(200, after)).toBeCloseTo(20.25, 4)
  })

  it('is undefined rather than infinite at a zero price', () => {
    expect(margin(0, 50)).toBeNull()
    expect(margin(null, 50)).toBeNull()
    expect(margin(200, null)).toBeNull()
  })
})
