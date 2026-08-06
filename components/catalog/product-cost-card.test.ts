import { describe, it, expect } from 'vitest'
import { splitLanded } from './product-cost-card'

// Merging shipping and tariff into one input must not disturb the two columns underneath. The
// database sums them BEFORE applying markup, so one combined figure and two separate ones that add
// to it produce an identical computed_cost — that is what makes this input-only and reversible.

const form = (landed: string, shipping = '', tariff = '') => ({ shipping, tariff, landed })

describe('splitting one landed-cost figure back into two columns', () => {
  it('leaves the recorded tariff untouched and puts the remainder in shipping', () => {
    // Row already has shipping 100 / tariff 50. Owner sees 150, changes it to 160.
    expect(splitLanded(true, form('160'), 50)).toEqual({ shippingCost: 110, tariffCost: 50 })
    // The customs figure survives, which is the entire reason the columns weren't merged.
  })

  it('sums to exactly what the owner typed', () => {
    const { shippingCost, tariffCost } = splitLanded(true, form('160'), 50)
    expect(shippingCost + tariffCost).toBe(160)
  })

  it('puts everything in shipping on a brand-new row', () => {
    expect(splitLanded(true, form('75'), 0)).toEqual({ shippingCost: 75, tariffCost: 0 })
  })

  it('honours a total smaller than the recorded tariff, even at the cost of the split', () => {
    // The only case where the breakdown is lost, and only because the owner has said the whole thing
    // costs less than the duty alone. Their number wins over our bookkeeping.
    expect(splitLanded(true, form('30'), 50)).toEqual({ shippingCost: 0, tariffCost: 30 })
  })

  it('treats an empty box as zero rather than as "unchanged"', () => {
    expect(splitLanded(true, form(''), 50)).toEqual({ shippingCost: 0, tariffCost: 0 })
  })

  it('leaves both fields alone for a tenant without the module', () => {
    expect(splitLanded(false, form('999', '100', '50'), 50)).toEqual({ shippingCost: 100, tariffCost: 50 })
  })
})

// The claim the whole approach rests on: (cost + shipping + tariff) × markup is unchanged by how the
// extras are divided, because the sum happens first.
describe('the margin is identical either way', () => {
  const computed = (cost: number, shipping: number, tariff: number, markup: number) =>
    (cost + shipping + tariff) * (1 + markup / 100)

  it('gives the same computed cost for a split and a combined figure', () => {
    const split = computed(1000, 100, 50, 10)
    const combined = computed(1000, 150, 0, 10)
    expect(split).toBe(combined)
    expect(split).toBe(1265)
  })

  it('and the same margin against the same price', () => {
    const margin = (price: number, cost: number) => ((price - cost) / price) * 100
    expect(margin(2000, computed(1000, 100, 50, 10))).toBe(margin(2000, computed(1000, 150, 0, 10)))
  })
})
