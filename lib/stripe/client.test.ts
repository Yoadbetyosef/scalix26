import { describe, it, expect, afterEach, vi } from 'vitest'
import Stripe from 'stripe'
import { getStripe, __resetStripeForTests } from './client'

// Regression tests for the null-client production bug: when STRIPE_SECRET_KEY was missing the module used to
// export `null as unknown as Stripe`, so `stripe.checkout.sessions.create(...)` crashed with
// "Cannot read properties of null (reading 'checkout')". getStripe() must instead return a real client when
// the key exists and throw a clear, controlled error when it doesn't — never null.
describe('getStripe (server-only Stripe client)', () => {
  const original = process.env.STRIPE_SECRET_KEY

  afterEach(() => {
    if (original === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = original
    __resetStripeForTests()
  })

  it('throws a controlled configuration error when STRIPE_SECRET_KEY is missing (never returns null)', () => {
    delete process.env.STRIPE_SECRET_KEY
    __resetStripeForTests()
    expect(() => getStripe()).toThrow('STRIPE_SECRET_KEY is not configured')
    // And it never silently hands back a null client for a caller to deref into `.checkout`.
    let client: Stripe | null = null
    try { client = getStripe() } catch { /* expected */ }
    expect(client).toBeNull()
  })

  it('initializes a real Stripe client with a working .checkout when the key exists', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_construction_only'
    __resetStripeForTests()
    const client = getStripe()
    expect(client).toBeInstanceOf(Stripe)
    expect(typeof client.checkout.sessions.create).toBe('function')
  })

  it('memoizes: repeated calls return the same client instance', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_construction_only'
    __resetStripeForTests()
    expect(getStripe()).toBe(getStripe())
  })
})

// The checkout route resolves the price SERVER-SIDE from PLANS[plan].priceId (client only sends the plan key).
// Verify each plan maps to its own STRIPE_*_PRICE_ID so Starter/Pro/Business can never collide or fall back.
describe('PLANS server-side price resolution', () => {
  afterEach(() => { vi.resetModules(); vi.unstubAllEnvs() })

  it('resolves the correct server-side price id for starter / pro / business', async () => {
    vi.resetModules()
    vi.stubEnv('STRIPE_STARTER_PRICE_ID', 'price_starter_test')
    vi.stubEnv('STRIPE_PRO_PRICE_ID', 'price_pro_test')
    vi.stubEnv('STRIPE_BUSINESS_PRICE_ID', 'price_business_test')
    const mod = await import('./client')
    expect(mod.PLANS.starter.priceId).toBe('price_starter_test')
    expect(mod.PLANS.pro.priceId).toBe('price_pro_test')
    expect(mod.PLANS.business.priceId).toBe('price_business_test')
    // Every advertised plan key must resolve to a distinct, defined price.
    const ids = [mod.PLANS.starter.priceId, mod.PLANS.pro.priceId, mod.PLANS.business.priceId]
    expect(new Set(ids).size).toBe(3)
  })
})
