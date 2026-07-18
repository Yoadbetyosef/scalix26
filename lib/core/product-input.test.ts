import { describe, it, expect } from 'vitest'
import { productInputSchema, productUpdateSchema } from './product-input'

describe('productInputSchema', () => {
  it('accepts a minimal valid product and defaults status to active', () => {
    const r = productInputSchema.safeParse({ name: 'Sofa' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.status).toBe('active')
  })
  it('requires a non-empty name', () => {
    expect(productInputSchema.safeParse({ name: '' }).success).toBe(false)
    expect(productInputSchema.safeParse({}).success).toBe(false)
  })
  it('rejects a negative price and accepts a valid one (dollars)', () => {
    expect(productInputSchema.safeParse({ name: 'X', price: -5 }).success).toBe(false)
    const ok = productInputSchema.safeParse({ name: 'X', price: 1299.99 })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.price).toBe(1299.99)
  })
  it('rejects an unknown status', () => {
    expect(productInputSchema.safeParse({ name: 'X', status: 'archived' }).success).toBe(false)
  })
})

describe('productUpdateSchema (partial)', () => {
  it('accepts an empty patch and a single-field patch', () => {
    expect(productUpdateSchema.safeParse({}).success).toBe(true)
    expect(productUpdateSchema.safeParse({ status: 'inactive' }).success).toBe(true)
  })
  it('still rejects an empty name when present', () => {
    expect(productUpdateSchema.safeParse({ name: '' }).success).toBe(false)
  })
})
