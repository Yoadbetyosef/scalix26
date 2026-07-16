import { describe, it, expect } from 'vitest'
import { computeDraftTotals } from './drafts'
import { reservationIdempotencyKey } from './number'

describe('Draft totals (pure money math, cents)', () => {
  it('subtotal = sum(qty*unit − line discount); total adds order discount/tax/delivery/additional', () => {
    const t = computeDraftTotals(
      [
        { quantity: 2, unitPriceCents: 500000, discountCents: 0 },      // 2 × $5000 = $10000
        { quantity: 1, unitPriceCents: 120000, discountCents: 20000 },  // $1200 − $200 = $1000
      ],
      { discountCents: 50000, taxCents: 80000, deliveryCents: 15000, additionalCents: 0 },
    )
    expect(t.subtotalCents).toBe(1000000 + 100000) // $11,000
    // total = 11,000 − 500 (order disc) + 800 (tax) + 150 (delivery) = $11,450
    expect(t.totalCents).toBe(1100000 - 50000 + 80000 + 15000)
  })
  it('a line discount never makes a line negative; empty draft totals 0', () => {
    expect(computeDraftTotals([{ quantity: 1, unitPriceCents: 1000, discountCents: 9999 }], { discountCents: 0, taxCents: 0, deliveryCents: 0, additionalCents: 0 }).subtotalCents).toBe(0)
    expect(computeDraftTotals([], { discountCents: 0, taxCents: 0, deliveryCents: 0, additionalCents: 0 }).totalCents).toBe(0)
  })
})

describe('Reservation idempotency key', () => {
  it('is stable per (draft,item,location) so repeated reserve clicks are one reservation', () => {
    const a = reservationIdempotencyKey('d1', 'product', 'p1', 'loc1')
    expect(a).toBe(reservationIdempotencyKey('d1', 'product', 'p1', 'loc1'))
    expect(a).not.toBe(reservationIdempotencyKey('d1', 'product', 'p1', 'loc2'))
  })
})
