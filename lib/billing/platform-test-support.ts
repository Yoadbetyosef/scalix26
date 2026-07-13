// ⚠️ TEST-ONLY SUPPORT — remove before any production promotion of Phase 7.
//
// Attaches a Stripe *test* PaymentMethod to a partner's customer so the platform-subscription lifecycle
// can be exercised end-to-end on Preview (real partners get a card via wallet top-ups; throwaway test
// partners have none). This exists solely to drive the Preview E2E and is guarded three ways: the calling
// endpoint is super-admin + Preview-gated, and this function HARD-REFUSES unless the Stripe key is test
// mode — so it can never touch live Stripe. It uses Stripe's shared test PaymentMethods (no real card data).

export type TestCardScenario = 'ok' | 'declined'

// Stripe's built-in test PaymentMethods: pm_card_visa always succeeds; pm_card_chargeDeclined always
// declines on charge (drives invoice.payment_failed → dunning).
const TEST_PM: Record<TestCardScenario, string> = { ok: 'pm_card_visa', declined: 'pm_card_chargeDeclined' }

export async function attachTestPaymentMethod(partnerId: string, scenario: TestCardScenario) {
  const { stripe } = await import('@/lib/stripe/client')
  const key = process.env.STRIPE_SECRET_KEY || ''
  if (!(key.startsWith('sk_test_') || key.startsWith('rk_test_'))) {
    throw new Error('refused: attachTestPaymentMethod requires a Stripe TEST key')
  }
  const { ensureStripeCustomer } = await import('./topup')
  const customerId = await ensureStripeCustomer(partnerId)
  const token = TEST_PM[scenario]

  // Attaching a shared test token (pm_card_visa) CLONES it into a real PaymentMethod on the customer —
  // use the RETURNED id (not the token) as the default, else Stripe rejects "not attached".
  let pmId: string
  try {
    const attached = await stripe.paymentMethods.attach(token, { customer: customerId })
    pmId = attached.id
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/already/i.test(msg)) throw e
    const list = await stripe.paymentMethods.list({ customer: customerId, type: 'card' })
    pmId = list.data[0]?.id
    if (!pmId) throw e
  }
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pmId } })

  const { createAdminClient } = await import('@/lib/supabase/server')
  await createAdminClient().from('partner_balances')
    .upsert({ partner_id: partnerId, stripe_customer_id: customerId, stripe_payment_method_id: pmId }, { onConflict: 'partner_id' })

  return { customerId, paymentMethod: pmId, scenario }
}

// Test teardown: delete the partner's Stripe TEST customer (which also cancels any of its subscriptions),
// and clear the stored customer/payment-method refs. Same hard test-key refusal.
export async function deleteTestCustomer(partnerId: string) {
  const { stripe } = await import('@/lib/stripe/client')
  const key = process.env.STRIPE_SECRET_KEY || ''
  if (!(key.startsWith('sk_test_') || key.startsWith('rk_test_'))) {
    throw new Error('refused: deleteTestCustomer requires a Stripe TEST key')
  }
  const { createAdminClient } = await import('@/lib/supabase/server')
  const db = createAdminClient()
  const { data: bal } = await db.from('partner_balances').select('stripe_customer_id').eq('partner_id', partnerId).maybeSingle()
  const customerId = bal?.stripe_customer_id
  if (customerId) { try { await stripe.customers.del(customerId) } catch { /* already gone */ } }
  await db.from('partner_balances')
    .update({ stripe_customer_id: null, stripe_payment_method_id: null, platform_subscription_id: null, platform_subscription_item_id: null })
    .eq('partner_id', partnerId)
  return { deletedCustomer: customerId ?? null }
}
