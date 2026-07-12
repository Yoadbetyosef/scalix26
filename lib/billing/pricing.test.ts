import { describe, it, expect, afterEach } from 'vitest'
import {
  computeCharge, roundCents, pickMarkupPct, priceUsage, DEFAULT_MARKUP_PCT,
  __setPricingSourceForTests, type MarkupRow, type PricingSource,
} from './pricing'

afterEach(() => __setPricingSourceForTests(null))

function source(rows: MarkupRow[], unit: number | null): PricingSource {
  return {
    loadMarkupRows: async () => rows,
    loadUnitCost: async () => unit,
  }
}

describe('computeCharge (pure markup)', () => {
  it('adds the markup percentage', () => {
    expect(computeCharge(100, 25)).toBe(125)
    expect(computeCharge(200, 25)).toBe(250)
  })
  it('is zero for zero cost and keeps fractional precision', () => {
    expect(computeCharge(0, 25)).toBe(0)
    expect(computeCharge(0.05, 25)).toBeCloseTo(0.0625, 6) // sub-cent LLM event
  })
})

describe('roundCents (only at the balance boundary)', () => {
  it('rounds to whole cents', () => {
    expect(roundCents(0.0625)).toBe(0)
    expect(roundCents(124.6)).toBe(125)
    expect(roundCents(0.5)).toBe(1)
  })
})

describe('pickMarkupPct resolution', () => {
  const global: MarkupRow = { scope: 'global', partner_id: null, markup_pct: 25, currency: 'usd' }
  const partner: MarkupRow = { scope: 'partner', partner_id: 'p1', markup_pct: 40, currency: 'usd' }

  it('uses the global default when no partner override', () => {
    expect(pickMarkupPct([global], 'p1', 'usd')).toBe(25)
  })
  it('prefers a matching partner override over global', () => {
    expect(pickMarkupPct([global, partner], 'p1', 'usd')).toBe(40)
  })
  it('ignores a partner override for a different partner', () => {
    expect(pickMarkupPct([global, partner], 'p2', 'usd')).toBe(25)
  })
  it('falls back to DEFAULT_MARKUP_PCT when config is missing', () => {
    expect(pickMarkupPct([], 'p1', 'usd')).toBe(DEFAULT_MARKUP_PCT)
  })
  it('matches on currency', () => {
    expect(pickMarkupPct([{ scope: 'global', partner_id: null, markup_pct: 30, currency: 'eur' }], null, 'usd'))
      .toBe(DEFAULT_MARKUP_PCT)
  })
})

describe('priceUsage', () => {
  it('prices a direct provider cost (e.g. LLM) through the markup', async () => {
    __setPricingSourceForTests(source([{ scope: 'global', partner_id: null, markup_pct: 25, currency: 'usd' }], null))
    const r = await priceUsage({ category: 'ai', providerCostCents: 0.05, partnerId: 'p1' })
    expect(r.providerCostCents).toBeCloseTo(0.05, 6)
    expect(r.markupPct).toBe(25)
    expect(r.partnerChargeCents).toBeCloseTo(0.0625, 6) // fractional preserved until the balance boundary
    expect(r.category).toBe('ai')
  })

  it('derives provider cost from the rate card (quantity × unit_cost)', async () => {
    // 3 SMS segments @ $0.0083 = $0.0249 = 2.49 cents, +25% = 3.1125 cents
    __setPricingSourceForTests(source([{ scope: 'global', partner_id: null, markup_pct: 25, currency: 'usd' }], 0.0083))
    const r = await priceUsage({ category: 'messaging', provider: 'scalix_messaging', metric: 'sms_segment', quantity: 3, partnerId: 'p1' })
    expect(r.providerCostCents).toBeCloseTo(2.49, 6)
    expect(r.partnerChargeCents).toBeCloseTo(3.1125, 6)
  })

  it('applies a per-partner markup override', async () => {
    __setPricingSourceForTests(source([
      { scope: 'global', partner_id: null, markup_pct: 25, currency: 'usd' },
      { scope: 'partner', partner_id: 'p1', markup_pct: 40, currency: 'usd' },
    ], null))
    const r = await priceUsage({ category: 'ai', providerCostCents: 100, partnerId: 'p1' })
    expect(r.markupPct).toBe(40)
    expect(r.partnerChargeCents).toBe(140)
  })

  it('throws when neither a direct cost nor rate inputs are given', async () => {
    __setPricingSourceForTests(source([], null))
    await expect(priceUsage({ category: 'other' })).rejects.toThrow()
  })

  it('treats a missing rate as zero provider cost (fail-safe, no NaN)', async () => {
    __setPricingSourceForTests(source([{ scope: 'global', partner_id: null, markup_pct: 25, currency: 'usd' }], null))
    const r = await priceUsage({ category: 'storage', provider: 'x', metric: 'y', quantity: 10 })
    expect(r.providerCostCents).toBe(0)
    expect(r.partnerChargeCents).toBe(0)
  })
})
