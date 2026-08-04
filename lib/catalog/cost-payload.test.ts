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
