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
  const pm = TEST_PM[scenario]

  // Attach + make default (idempotent enough for a throwaway customer; ignore "already attached").
  try { await stripe.paymentMethods.attach(pm, { customer: customerId }) } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/already been attached|already attached/i.test(msg)) throw e
  }
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm } })

  const { createAdminClient } = await import('@/lib/supabase/server')
  await createAdminClient().from('partner_balances')
    .upsert({ partner_id: partnerId, stripe_customer_id: customerId, stripe_payment_method_id: pm }, { onConflict: 'partner_id' })

  return { customerId, paymentMethod: pm, scenario }
}
