import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/server'

// Prepaid wallet funding via Stripe (PLATFORM account — this is money IN from partners, distinct from
// the partner Connect EXPRESS payouts, which are money OUT). A top-up saves the card (off-session) so
// auto-reload can charge it later. Nothing here charges without the partner completing Stripe Checkout.

export const TOPUP_AMOUNTS_CENTS = [25000, 50000, 100000, 250000, 500000] as const // $250 / $500 / $1k / $2.5k / $5k
export const MIN_TOPUP_CENTS = 5000       // $50 minimum custom top-up
export const MAX_TOPUP_CENTS = 2_000_000  // $20k maximum per top-up

export function isValidTopupAmount(cents: number): boolean {
  return Number.isInteger(cents) && cents >= MIN_TOPUP_CENTS && cents <= MAX_TOPUP_CENTS
}

// Ensure the partner has a PLATFORM Stripe customer (created once, cached on partner_balances).
export async function ensureStripeCustomer(partnerId: string): Promise<string> {
  const db = createAdminClient()
  const { data: bal } = await db.from('partner_balances').select('stripe_customer_id').eq('partner_id', partnerId).maybeSingle()
  if (bal?.stripe_customer_id) return bal.stripe_customer_id

  const { data: p } = await db.from('partners').select('company_name, contact_email').eq('id', partnerId).maybeSingle()
  const customer = await stripe.customers.create({
    name: p?.company_name || undefined,
    email: p?.contact_email || undefined,
    metadata: { partner_id: partnerId },
  })
  await db.from('partner_balances').upsert({ partner_id: partnerId, stripe_customer_id: customer.id }, { onConflict: 'partner_id' })
  return customer.id
}

// Manual top-up Checkout (mode=payment). setup_future_usage saves the card for off-session auto-reload.
export async function createTopupCheckout(partnerId: string, amountCents: number, baseUrl: string): Promise<{ url: string | null }> {
  const customer = await ensureStripeCustomer(partnerId)
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer,
    line_items: [{
      price_data: { currency: 'usd', unit_amount: amountCents, product_data: { name: 'Account balance top-up' } },
      quantity: 1,
    }],
    payment_intent_data: { setup_future_usage: 'off_session', metadata: { kind: 'balance_topup', partner_id: partnerId } },
    metadata: { kind: 'balance_topup', partner_id: partnerId, amount_cents: String(amountCents) },
    success_url: `${baseUrl}/partner/balance?topup=success`,
    cancel_url: `${baseUrl}/partner/balance?topup=cancel`,
  })
  return { url: session.url }
}

// Save / update a card without charging (mode=setup) — for enabling auto-reload up front.
export async function createSetupCheckout(partnerId: string, baseUrl: string): Promise<{ url: string | null }> {
  const customer = await ensureStripeCustomer(partnerId)
  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    customer,
    metadata: { kind: 'save_card', partner_id: partnerId },
    success_url: `${baseUrl}/partner/balance?card=saved`,
    cancel_url: `${baseUrl}/partner/balance`,
  })
  return { url: session.url }
}
