import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/server'
import { creditBalance } from './balance'

// Stripe webhook handling for the prepaid wallet. Returns true when it handled the event (so the main
// tenant-subscription webhook can skip it). All credits are idempotent (keyed on the Stripe object id),
// so retries never double-credit. Money IN only — never charges here.

const pmId = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === 'string' ? v : v?.id ?? null

async function savePaymentMethod(partnerId: string, paymentMethodId: string | null) {
  if (!paymentMethodId) return
  await createAdminClient().from('partner_balances')
    .update({ stripe_payment_method_id: paymentMethodId }).eq('partner_id', partnerId)
}

export async function handleBalanceStripeEvent(event: Stripe.Event): Promise<boolean> {
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as Stripe.Checkout.Session
    const partnerId = s.metadata?.partner_id
    const kind = s.metadata?.kind
    if (!partnerId) return false

    if (kind === 'balance_topup') {
      const amount = s.amount_total ?? 0
      if (amount > 0) {
        await creditBalance(partnerId, amount, { type: 'top_up', idempotencyKey: `topup:${s.id}`, stripeRef: s.id })
      }
      // Persist the card (setup_future_usage) so auto-reload can charge it off-session. Best-effort —
      // a card-lookup failure must never block the credit that already succeeded.
      try {
        if (s.payment_intent) {
          const pi = await stripe.paymentIntents.retrieve(pmId(s.payment_intent as string | { id: string })!)
          await savePaymentMethod(partnerId, pmId(pi.payment_method as string | { id: string } | null))
        }
      } catch { /* card save is best-effort */ }
      return true
    }
    if (kind === 'save_card') {
      try {
        if (s.setup_intent) {
          const si = await stripe.setupIntents.retrieve(pmId(s.setup_intent as string | { id: string })!)
          await savePaymentMethod(partnerId, pmId(si.payment_method as string | { id: string } | null))
        }
      } catch { /* best-effort */ }
      return true
    }
    return false
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    if (pi.metadata?.kind !== 'auto_reload') return false
    const partnerId = pi.metadata.partner_id
    const amount = pi.amount_received || pi.amount || 0
    if (partnerId && amount > 0) {
      await creditBalance(partnerId, amount, { type: 'auto_reload', idempotencyKey: `auto_reload:${pi.id}`, stripeRef: pi.id })
      await createAdminClient().from('partner_balances')
        .update({ auto_reload_pending: false, last_auto_reload_at: new Date().toISOString() }).eq('partner_id', partnerId)
    }
    return true
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object as Stripe.PaymentIntent
    if (pi.metadata?.kind !== 'auto_reload') return false
    const partnerId = pi.metadata.partner_id
    if (partnerId) {
      const db = createAdminClient()
      await db.from('partner_balances').update({ auto_reload_pending: false }).eq('partner_id', partnerId)
      await db.from('partner_notifications').insert({
        partner_id: partnerId, kind: 'billing', title: 'Auto-reload failed',
        body: "We couldn't charge your saved card to top up your balance. Update your payment method or add funds manually to avoid interruption.",
        link: '/partner/balance',
      }).then(() => {}, () => {})
    }
    return true
  }

  return false
}
