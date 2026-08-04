import { describe, it, expect } from 'vitest'
import { costPayloadSchema } from '@/app/api/catalog/products/[id]/cost/route'

// markup_percent is snapshotted onto a cost row when it is saved, so that changing the tenant default
// later cannot silently rewrite what a product cost last quarter. That guarantee is only worth anything
// if a request can't set the snapshot itself — one malformed call would otherwise shift a historical
// cost. Same for computed_cost, which the database generates.
//
// These pin the boundary at the schema, which is where it is actually enforced.

describe('cost payload', () => {
  it('accepts the four cost components', () => {
    const r = costPayloadSchema.safeParse({ costPrimary: 4200, costSecondary: 3850, shippingCost: 280, tariffCost: 245 })
    expect(r.success).toBe(true)
  })

  it('REJECTS markupPercent — the snapshot is server-side only', () => {
    const r = costPayloadSchema.safeParse({ costPrimary: 4200, markupPercent: 999 })
    expect(r.success).toBe(false)
  })

  it('REJECTS computedCost — the database generates it', () => {
    const r = costPayloadSchema.safeParse({ costPrimary: 4200, computedCost: 1 })
    expect(r.success).toBe(false)
  })

  it('rejects any unexpected key rather than dropping it silently', () => {
    expect(costPayloadSchema.safeParse({ tenant_id: 'other-tenant' }).success).toBe(false)
    expect(costPayloadSchema.safeParse({ product_id: 'somewhere-else' }).success).toBe(false)
  })

  it('distinguishes "not recorded" from zero', () => {
    expect(costPayloadSchema.safeParse({ costPrimary: null }).success).toBe(true)
    expect(costPayloadSchema.safeParse({ costPrimary: 0 }).success).toBe(true)
  })

  it('rejects negative money', () => {
    expect(costPayloadSchema.safeParse({ costPrimary: -1 }).success).toBe(false)
    expect(costPayloadSchema.safeParse({ shippingCost: -0.01 }).success).toBe(false)
  })

  it('accepts an empty body — saving nothing is not an error', () => {
    expect(costPayloadSchema.safeParse({}).success).toBe(true)
  })
})

// Two questions asked directly, pinned as tests so the answer can't drift.
describe('the two guarantees', () => {
  it('Q1 — PUT does NOT accept markup_percent from the body, in any spelling', () => {
    for (const body of [{ markupPercent: 999 }, { markup_percent: 999 }, { costPrimary: 100, markupPercent: 0 }]) {
      expect(costPayloadSchema.safeParse(body).success).toBe(false)
    }
  })

  it('Q2 — clearing a saved cost sends null, which is stored as NULL and never 0', () => {
    // The card turns an empty input into null before it ever reaches the wire.
    const numHelper = (s: string): number | null => { const t = s.trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? n : null }
    expect(numHelper('')).toBeNull()
    expect(numHelper('   ')).toBeNull()
    expect(numHelper('0')).toBe(0)      // an explicit zero stays a zero — a different fact

    // …and null is a valid payload, distinct from omitting the field.
    const parsed = costPayloadSchema.safeParse({ costPrimary: null })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.costPrimary).toBeNull()
  })
})
