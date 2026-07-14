import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { createServiceClient } from '@/lib/supabase/server'
import { provisionTenantPhoneNumber } from '@/lib/twilio/provision'
import { releaseTenantNumbers } from '@/lib/twilio/release'
import { sendEmail, emailTemplates } from '@/lib/email/send'
import { notifyAdminPaymentFailed } from '@/lib/admin/notify'
import { recordBillingEvent } from '@/lib/partner/economics'
import { recordLifecycleEvent } from '@/lib/command-center/lifecycle-events'
import { enforce, clientIp } from '@/lib/ratelimit'
import { handleBalanceStripeEvent } from '@/lib/billing/stripe-events'
import { handlePlatformStripeEvent } from '@/lib/billing/platform-events'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.mylocksmithai.com'

// Stripe subscription statuses that still count as "paying" — if any remain after a
// cancellation (plan switch / multiple subs), we must NOT release the number.
const PAYING_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid'])

async function getTenantByCustomer(supabase: Awaited<ReturnType<typeof createServiceClient>>, customerId: string) {
  const { data } = await supabase.from('tenants').select('*').eq('stripe_customer_id', customerId).single()
  return data
}

export async function POST(req: NextRequest) {
  const flood = await enforce('webhook_stripe', `stripe:${clientIp(req)}`)
  if (flood) return flood
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')!

  let event
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Prepaid wallet events (partner balance top-ups / auto-reload / saved cards) are handled here and
  // short-circuit — they're a separate money flow from the tenant subscription switch below.
  if (await handleBalanceStripeEvent(event)) return NextResponse.json({ received: true })

  // WL PLATFORM subscription events ($97/mo per active client) — a THIRD, separate money flow from both
  // the wallet and tenant plans. Identified by subscription metadata kind='wl_platform_fee'.
  if (await handlePlatformStripeEvent(event, Date.now())) return NextResponse.json({ received: true })

  const supabase = await createServiceClient()

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object
      const planMap: Record<string, string> = {
        [process.env.STRIPE_STARTER_PRICE_ID!]: 'starter',
        [process.env.STRIPE_PRO_PRICE_ID!]: 'pro',
        [process.env.STRIPE_BUSINESS_PRICE_ID!]: 'business',
      }
      const priceId = sub.items.data[0]?.price.id
      const plan = planMap[priceId] || 'starter'

      await supabase
        .from('tenants')
        .update({ plan, stripe_subscription_id: sub.id })
        .eq('stripe_customer_id', sub.customer)

      // Command Center lifecycle instrumentation (best-effort). We do NOT infer upgrade/downgrade — the
      // price→plan map defaults unknown prices to 'starter', so it's unreliable; classify as
      // subscription_changed (or created/pause/reactivation) and keep the raw price id in metadata.
      const subTenant = await getTenantByCustomer(supabase, sub.customer as string)
      const occurredAt = new Date(event.created * 1000).toISOString()
      const prev = (event.data as { previous_attributes?: { pause_collection?: unknown } }).previous_attributes
      const kind = event.type === 'customer.subscription.created' ? 'subscription_created'
        : sub.pause_collection ? 'pause'
        : prev && 'pause_collection' in prev && !sub.pause_collection ? 'reactivation'
        : 'subscription_changed'
      await recordLifecycleEvent({ tenantId: subTenant?.id ?? null, kind, sourceEventId: event.id, occurredAt, newState: sub.status, metadata: { priceId, plan } })
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object
      const tenant = await getTenantByCustomer(supabase, sub.customer as string)
      await supabase.from('tenants').update({ plan: 'trial' }).eq('stripe_customer_id', sub.customer)
      if (tenant) {
        // Economics: emit a 'cancelled' billing event (→ churn + clawback via the processor).
        await recordBillingEvent({ tenantId: tenant.id, type: 'cancelled', source: 'stripe', sourceRef: sub.id, idempotencyKey: `be:cancel:${sub.id}` })
        // Command Center: event-source the cancellation (best-effort; never breaks the webhook).
        await recordLifecycleEvent({ tenantId: tenant.id, kind: 'cancellation', sourceEventId: event.id, occurredAt: new Date(event.created * 1000).toISOString() })

        const tmpl = emailTemplates.subscriptionCancelled(tenant.business_name)
        await sendEmail(tenant.email, tmpl.subject, tmpl.html)

        // Release this tenant's Twilio number(s) to stop recurring cost. Fully
        // guarded + fail-safe: a failure here must never break the webhook.
        try {
          // Guard: only release if NO other paying subscription remains for this
          // customer (handles plan switches / multiple subs). Excludes the sub
          // that was just deleted.
          const subs = await stripe.subscriptions.list({ customer: sub.customer as string, status: 'all', limit: 100 })
          const stillPaying = subs.data.some((s) => s.id !== sub.id && PAYING_STATUSES.has(s.status))
          if (stillPaying) {
            console.log('[stripe] subscription.deleted but customer still has a paying sub — NOT releasing numbers', sub.customer)
          } else {
            const result = await releaseTenantNumbers(tenant.id)
            console.log('[stripe] released tenant numbers on cancellation', tenant.id, result)
          }
        } catch (err) {
          console.error('[stripe] number release failed (non-fatal):', err instanceof Error ? err.message : err)
        }
      }
      break
    }

    case 'checkout.session.completed': {
      const session = event.data.object
      if (session.customer && session.metadata?.tenantId) {
        await supabase
          .from('tenants')
          .update({ stripe_customer_id: session.customer })
          .eq('id', session.metadata.tenantId)
        provisionTenantPhoneNumber(session.metadata.tenantId).catch(err =>
          console.error('[provision] Failed to provision phone number:', err)
        )
      }
      break
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object
      if (!invoice.customer) break
      const tenant = await getTenantByCustomer(supabase, invoice.customer as string)
      if (!tenant) break
      const amount = invoice.amount_paid || 0
      const date = new Date(invoice.created * 1000).toLocaleDateString()
      const tmpl = emailTemplates.paymentSuccess(tenant.business_name, amount, date)
      await sendEmail(tenant.email, tmpl.subject, tmpl.html)

      // Economics: emit a billing event (conversion / renewal / upgrade) → the processor turns it
      // into commission entries stamped with source_event_id. Idempotent per invoice id.
      const reason = invoice.billing_reason || ''
      const evType = reason === 'subscription_create' ? 'converted_paid' : reason === 'subscription_update' ? 'plan_upgraded' : 'renewed'
      await recordBillingEvent({ tenantId: tenant.id, type: evType, amountCents: invoice.amount_paid || 0, currency: invoice.currency || 'usd', source: 'stripe', sourceRef: invoice.id, idempotencyKey: `be:${evType}:${invoice.id}`, props: { billing_reason: reason } })
      // Command Center: a succeeded invoice after a prior failure is a payment recovery.
      if (((invoice as { attempt_count?: number }).attempt_count ?? 1) > 1) {
        await recordLifecycleEvent({ tenantId: tenant.id, kind: 'recovery', sourceEventId: event.id, occurredAt: new Date(event.created * 1000).toISOString(), mrrCents: invoice.amount_paid || 0 })
      }
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object
      if (!invoice.customer) break
      const tenant = await getTenantByCustomer(supabase, invoice.customer as string)
      if (!tenant) break

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: invoice.customer as string,
        return_url: `${APP_URL}/settings`,
      }).catch(() => null)

      const updateUrl = portalSession?.url || `${APP_URL}/settings`
      const amount = invoice.amount_due || 0
      // Command Center: event-source the failed payment (best-effort; never breaks the webhook).
      await recordLifecycleEvent({ tenantId: tenant.id, kind: 'failed_payment', mrrCents: amount, sourceEventId: event.id, occurredAt: new Date(event.created * 1000).toISOString() })

      // Email customer
      const customerTmpl = emailTemplates.paymentFailed(tenant.business_name, updateUrl)
      await sendEmail(tenant.email, customerTmpl.subject, customerTmpl.html)

      // Notify admin
      await notifyAdminPaymentFailed({
        name: tenant.business_name,
        email: tenant.email,
        plan: tenant.plan,
        amount,
      })

      // After 7 days Stripe retries automatically — on final failure, pause account
      const attemptCount = invoice.attempt_count || 1
      if (attemptCount >= 3) {
        await supabase.from('tenants').update({ plan: 'trial' }).eq('id', tenant.id)
      }
      break
    }

    case 'payment_method.updated': {
      // Card updated — notify customer
      const pm = event.data.object
      if (!pm.customer) break
      const tenant = await getTenantByCustomer(supabase, pm.customer as string)
      if (!tenant) break
      const tmpl = emailTemplates.cardUpdated(tenant.business_name)
      await sendEmail(tenant.email, tmpl.subject, tmpl.html)
      break
    }

    case 'charge.refunded': {
      // Economics: refund → clawback (negative commission) via the processor.
      const charge = event.data.object
      if (!charge.customer) break
      const tenant = await getTenantByCustomer(supabase, charge.customer as string)
      if (!tenant) break
      await recordBillingEvent({ tenantId: tenant.id, type: 'refunded', amountCents: charge.amount_refunded || 0, currency: charge.currency || 'usd', source: 'stripe', sourceRef: charge.id, idempotencyKey: `be:refund:${charge.id}` })
      await recordLifecycleEvent({ tenantId: tenant.id, kind: 'refund', sourceEventId: event.id, occurredAt: new Date(event.created * 1000).toISOString(), mrrCents: charge.amount_refunded || 0 })
      break
    }

    case 'charge.dispute.created': {
      // Economics: chargeback → clawback. Resolve the customer via the disputed charge.
      const dispute = event.data.object
      try {
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
        if (!chargeId) break
        const charge = await stripe.charges.retrieve(chargeId)
        if (!charge.customer) break
        const tenant = await getTenantByCustomer(supabase, charge.customer as string)
        if (!tenant) break
        await recordBillingEvent({ tenantId: tenant.id, type: 'chargeback', amountCents: dispute.amount || 0, currency: dispute.currency || 'usd', source: 'stripe', sourceRef: dispute.id, idempotencyKey: `be:chargeback:${dispute.id}` })
        await recordLifecycleEvent({ tenantId: tenant.id, kind: 'chargeback', sourceEventId: event.id, occurredAt: new Date(event.created * 1000).toISOString(), mrrCents: dispute.amount || 0 })
      } catch (e) {
        console.error('[stripe] chargeback handling failed:', e instanceof Error ? e.message : e)
      }
      break
    }

    case 'charge.dispute.closed': {
      // Command Center: a dispute resolved in our favour is a chargeback reversal.
      const dispute = event.data.object
      if (dispute.status !== 'won') break
      try {
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
        if (!chargeId) break
        const charge = await stripe.charges.retrieve(chargeId)
        const tenant = charge.customer ? await getTenantByCustomer(supabase, charge.customer as string) : null
        await recordLifecycleEvent({ tenantId: tenant?.id ?? null, kind: 'chargeback_reversed', sourceEventId: event.id, occurredAt: new Date(event.created * 1000).toISOString(), mrrCents: dispute.amount || 0 })
      } catch (e) {
        console.error('[stripe] dispute.closed handling failed:', e instanceof Error ? e.message : e)
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
