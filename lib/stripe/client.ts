import Stripe from 'stripe'

// SERVER-ONLY Stripe client. Never import this into a client component — it would leak STRIPE_SECRET_KEY.
//
// Previously this module did `process.env.STRIPE_SECRET_KEY ? new Stripe(...) : null as unknown as Stripe`,
// so whenever the key was absent at runtime `stripe` was silently `null` and every call site crashed with
// "Cannot read properties of null (reading 'checkout')" — with no hint that the real problem was a missing
// key. It is resolved lazily (not at import time) so a missing key can never crash unrelated pages that
// transitively import this module; the controlled error is raised only when a Stripe call is actually made.
const STRIPE_API_VERSION = '2026-05-27.dahlia' as const

let cachedStripe: Stripe | null = null

/**
 * Returns the shared server-side Stripe client, constructing it on first use.
 * Throws a clear, controlled configuration error if STRIPE_SECRET_KEY is missing — never returns null.
 */
export function getStripe(): Stripe {
  if (cachedStripe) return cachedStripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  cachedStripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION })
  return cachedStripe
}

/** Test-only: clear the memoized client so a following getStripe() re-reads the environment. */
export function __resetStripeForTests() {
  cachedStripe = null
}

// Back-compat named export used across server routes/libs (`import { stripe } from '@/lib/stripe/client'`).
// A lazy proxy that resolves through getStripe() on first property access, so existing
// `stripe.checkout.sessions.create(...)` call sites keep working AND can never be null: if the key is
// missing they throw the same controlled "STRIPE_SECRET_KEY is not configured" error instead of a null deref.
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const client = getStripe() as unknown as Record<PropertyKey, unknown>
    const value = client[prop]
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value
  },
})

export const PLANS = {
  starter: {
    name: 'Starter',
    price: 297,
    priceId: process.env.STRIPE_STARTER_PRICE_ID!,
    features: ['1 AI Employee', '500 conversations/mo', 'SMS + Voice'],
    maxEmployees: 1,
    maxConversations: 500,
  },
  pro: {
    name: 'Pro',
    price: 397,
    priceId: process.env.STRIPE_PRO_PRICE_ID!,
    features: ['3 AI Employees', '2,000 conversations/mo', 'All channels'],
    maxEmployees: 3,
    maxConversations: 2000,
  },
  business: {
    name: 'Business',
    price: 597,
    priceId: process.env.STRIPE_BUSINESS_PRICE_ID!,
    features: ['Unlimited AI Employees', 'Unlimited conversations', 'Priority support'],
    maxEmployees: Infinity,
    maxConversations: Infinity,
  },
} as const
