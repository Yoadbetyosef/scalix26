import type Stripe from 'stripe'
import { platformFeeEnabled, onPlatformInvoicePaid, onPlatformInvoiceFailed, onPlatformSubscriptionCanceled } from './platform-fee'

// Stripe webhook handling for the WL PLATFORM subscription ($97/mo per active client). Returns true when
// it handled the event so the main tenant-subscription webhook skips it — platform subscriptions must
// NEVER be confused with tenant plan subscriptions. Platform events are identified by the subscription
// metadata {kind:'wl_platform_fee', partner_id} that syncPlatformQuantity stamps at creation.
//
// Idempotent by construction: every state change is keyed on the Stripe object id in
// platform_subscription_events (a replayed webhook can't double-apply). INERT unless
// WL_PLATFORM_FEE_ENABLED=true — a stray platform event is still short-circuited but applies nothing.

// Pull {kind, partner_id} from wherever Stripe surfaces the subscription metadata on an invoice. The SDK
// shape varies by API version, so read defensively: subscription_details.metadata → line item metadata.
function platformPartnerFromInvoice(inv: Stripe.Invoice): string | null {
  const anyInv = inv as unknown as {
    subscription_details?: { metadata?: Record<string, string> }
    lines?: { data?: Array<{ metadata?: Record<string, string> }> }
    metadata?: Record<string, string>
  }
  const candidates = [
    anyInv.subscription_details?.metadata,
    anyInv.lines?.data?.[0]?.metadata,
    anyInv.metadata,
  ]
  for (const m of candidates) {
    if (m && m.kind === 'wl_platform_fee' && m.partner_id) return m.partner_id
  }
  return null
}

function subIdFromInvoice(inv: Stripe.Invoice): string | null {
  const v = (inv as unknown as { subscription?: string | { id: string } | null }).subscription
  return typeof v === 'string' ? v : v?.id ?? null
}

function periodEndFromInvoice(inv: Stripe.Invoice): string | null {
  const line = (inv as unknown as { lines?: { data?: Array<{ period?: { end?: number } }> } }).lines?.data?.[0]
  const end = line?.period?.end ?? (inv as unknown as { period_end?: number }).period_end
  return end ? new Date(end * 1000).toISOString() : null
}

export async function handlePlatformStripeEvent(event: Stripe.Event, nowMs: number): Promise<boolean> {
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
    const inv = event.data.object as Stripe.Invoice
    const partnerId = platformPartnerFromInvoice(inv)
    if (!partnerId) return false
    if (platformFeeEnabled()) {
      await onPlatformInvoicePaid(partnerId, {
        invoiceId: inv.id as string,
        amountCents: (inv.amount_paid ?? inv.total ?? 0) as number,
        currency: inv.currency, periodEnd: periodEndFromInvoice(inv), subscriptionId: subIdFromInvoice(inv),
      })
    }
    return true
  }

  if (event.type === 'invoice.payment_failed') {
    const inv = event.data.object as Stripe.Invoice
    const partnerId = platformPartnerFromInvoice(inv)
    if (!partnerId) return false
    if (platformFeeEnabled()) {
      await onPlatformInvoiceFailed(partnerId, {
        invoiceId: inv.id as string, amountCents: (inv.amount_due ?? inv.total ?? 0) as number, subscriptionId: subIdFromInvoice(inv),
      }, nowMs)
    }
    return true
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    if (sub.metadata?.kind !== 'wl_platform_fee') return false
    const partnerId = sub.metadata.partner_id
    if (!partnerId) return false
    if (platformFeeEnabled()) await onPlatformSubscriptionCanceled(partnerId, { subscriptionId: sub.id })
    return true
  }

  return false
}
