import { describe, it, expect } from 'vitest'
import { lineTotalCents, documentTotals, depositCents } from './money'

describe('lineTotalCents', () => {
  it('qty × unit, integer cents', () => expect(lineTotalCents({ quantity: 3, unit_price_cents: 12500 })).toBe(37500))
  it('applies discount then tax', () => expect(lineTotalCents({ quantity: 2, unit_price_cents: 10000, discount_cents: 1500, tax_cents: 1850 })).toBe(20000 - 1500 + 1850))
  it('discount floors at 0 (never negative)', () => expect(lineTotalCents({ quantity: 1, unit_price_cents: 1000, discount_cents: 5000 })).toBe(0))
  it('fractional quantity rounds deterministically', () => expect(lineTotalCents({ quantity: 1.5, unit_price_cents: 333 })).toBe(500))
})

describe('documentTotals', () => {
  it('sums lines into subtotal/discount/tax/total', () => {
    const t = documentTotals([
      { quantity: 2, unit_price_cents: 10000, discount_cents: 1000, tax_cents: 900 },
      { quantity: 1, unit_price_cents: 5000, tax_cents: 450 },
    ])
    expect(t).toEqual({ subtotal_cents: 25000, discount_cents: 1000, tax_cents: 1350, total_cents: 25000 - 1000 + 1350 })
  })
  it('empty doc = zeros', () => expect(documentTotals([])).toEqual({ subtotal_cents: 0, discount_cents: 0, tax_cents: 0, total_cents: 0 }))
})

describe('depositCents', () => {
  it('percent of total', () => expect(depositCents(100000, { kind: 'percent', percent: 30 })).toBe(30000))
  it('fixed, capped at total', () => { expect(depositCents(100000, { kind: 'fixed', cents: 25000 })).toBe(25000); expect(depositCents(10000, { kind: 'fixed', cents: 25000 })).toBe(10000) })
})
