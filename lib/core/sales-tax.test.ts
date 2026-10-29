import { describe, it, expect } from 'vitest'
import { salesTaxFor, lineTaxCents } from './sales-tax'
import { lineTotalCents } from './money'

describe('sales tax', () => {
  it('New Jersey is 6.625% statewide, by code or by name', () => {
    expect(salesTaxFor('NJ')?.rate).toBe(0.06625)
    expect(salesTaxFor(' new jersey ')?.rate).toBe(0.06625)
  })
  it('a state with no known rate gets no toggle', () => {
    expect(salesTaxFor(null)).toBeNull()
    expect(salesTaxFor('')).toBeNull()
    expect(salesTaxFor('OR')).toBeNull()
  })
  it('is taken on the line after its discount, in whole cents', () => {
    expect(lineTaxCents({ quantity: 1, unit_price_cents: 100_000 }, 0.06625)).toBe(6625)
    expect(lineTaxCents({ quantity: 2, unit_price_cents: 4_999 }, 0.06625)).toBe(662) // 9998 × 0.06625 = 662.37
    expect(lineTaxCents({ quantity: 1, unit_price_cents: 10_000, discount_cents: 2_000 }, 0.06625)).toBe(530)
  })
  it('lands in the line total', () => {
    const l = { quantity: 1, unit_price_cents: 1_500_000 }
    expect(lineTotalCents({ ...l, tax_cents: lineTaxCents(l, 0.06625) })).toBe(1_599_375)
  })
})
