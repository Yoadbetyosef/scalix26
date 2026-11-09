import { describe, it, expect } from 'vitest'
import { docDiscountCents, spreadDiscount, discountLabel, documentTotals } from './money'
import { lineTaxCents } from './sales-tax'

describe('docDiscountCents', () => {
  it('percent of the subtotal', () => expect(docDiscountCents(250000, { kind: 'percent', value: 10 })).toBe(25000))
  it('percent rounds to the cent', () => expect(docDiscountCents(333, { kind: 'percent', value: 15 })).toBe(50))
  it('percent caps at 100', () => expect(docDiscountCents(1000, { kind: 'percent', value: 150 })).toBe(1000))
  it('amount in dollars', () => expect(docDiscountCents(250000, { kind: 'amount', value: 300 })).toBe(30000))
  it('amount caps at the subtotal', () => expect(docDiscountCents(1000, { kind: 'amount', value: 50 })).toBe(1000))
  it('nothing chosen = 0', () => {
    expect(docDiscountCents(1000, null)).toBe(0)
    expect(docDiscountCents(1000, { kind: 'percent', value: 0 })).toBe(0)
  })
})

describe('spreadDiscount', () => {
  it('parts sum exactly to the discount', () => {
    const parts = spreadDiscount([10000, 3333, 6667], 1001)
    expect(parts.reduce((s, p) => s + p, 0)).toBe(1001)
  })
  it('in proportion to gross', () => expect(spreadDiscount([30000, 10000], 4000)).toEqual([3000, 1000]))
  it('zero discount = zeros', () => expect(spreadDiscount([100, 200], 0)).toEqual([0, 0]))
})

describe('a discounted, taxed invoice', () => {
  it('tax is on the discounted price', () => {
    const gross = [200000, 50000]
    const disc = spreadDiscount(gross, docDiscountCents(250000, { kind: 'percent', value: 10 }))
    const lines = gross.map((g, i) => {
      const l = { quantity: 1, unit_price_cents: g, discount_cents: disc[i] }
      return { ...l, tax_cents: lineTaxCents(l, 0.06625) }
    })
    const t = documentTotals(lines)
    expect(t.subtotal_cents).toBe(250000)
    expect(t.discount_cents).toBe(25000)
    expect(t.tax_cents).toBe(Math.round(180000 * 0.06625) + Math.round(45000 * 0.06625))
    expect(t.total_cents).toBe(225000 + t.tax_cents)
  })
})

describe('discountLabel', () => {
  it('shows the percent when chosen as a percent', () => expect(discountLabel('percent', 10)).toBe('Discount (10%)'))
  it('plain for an amount', () => expect(discountLabel('amount', 300)).toBe('Discount'))
})
