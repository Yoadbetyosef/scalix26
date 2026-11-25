import { describe, it, expect } from 'vitest'
import { costColumnFor, priceListChunkSchema } from './pricelist-import'

describe('where a price list lands', () => {
  it('base currency → the cost actually paid', () => {
    expect(costColumnFor('EUR', 'EUR', null)).toBe('cost_primary')
    expect(costColumnFor('usd', 'USD', 'EUR')).toBe('cost_primary')
  })
  it('the business\'s second currency → the supplier reference figure, never converted', () => {
    expect(costColumnFor('EUR', 'USD', 'EUR')).toBe('cost_secondary')
  })
  it('a currency the business does not use is refused, not guessed', () => {
    expect(costColumnFor('EUR', 'USD', null)).toBeNull()
    expect(costColumnFor('GBP', 'USD', 'EUR')).toBeNull()
  })
})

describe('the chunk shape', () => {
  const item = { sku: '2051520', name: 'ISLA DINING ARMCHAIR', cost: null, variants: [{ label: 'Fabric category A', fabricCategory: 'A', cost: 588 }] }
  it('accepts a product priced per fabric category', () => {
    expect(priceListChunkSchema.safeParse({ currency: 'EUR', items: [item] }).success).toBe(true)
  })
  it('refuses a negative cost and an oversized chunk', () => {
    expect(priceListChunkSchema.safeParse({ currency: 'EUR', items: [{ ...item, cost: -1 }] }).success).toBe(false)
    expect(priceListChunkSchema.safeParse({ currency: 'EUR', items: Array(201).fill(item) }).success).toBe(false)
  })
})
