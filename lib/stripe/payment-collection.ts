import type { SupabaseClient } from '@supabase/supabase-js'
import { stripe } from './client'
import { sendEmail } from '@/lib/email/send'

// ── Payment Collection ───────────────────────────────────────────────────────────
// Per-agent settings + owner-approval helpers. Enforcement lives at the payment-link
// route (the chokepoint the AI tool calls) — the fenced pipeline/booking files are not
// touched. Money always goes to the tenant's connected account; we never hold funds.

export interface PaymentCollectionSettings {
  require_approval: boolean       // default ON
  allow_custom_amount: boolean
  allow_products: boolean         // default ON
  deposit_type: 'none' | 'fixed' | 'percent'
  deposit_value: number           // fixed = dollars; percent = 0–100
  channels: { sms: boolean; email: boolean; whatsapp: boolean }
}

export const DEFAULT_PAYMENT_SETTINGS: PaymentCollectionSettings = {
  require_approval: true,
  allow_custom_amount: false,
  allow_products: true,
  deposit_type: 'none',
  deposit_value: 0,
  channels: { sms: true, email: true, whatsapp: true },
}

export function normalizePaymentSettings(raw: unknown): PaymentCollectionSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ch = (r.channels && typeof r.channels === 'object' ? r.channels : {}) as Record<string, unknown>
  const dt = r.deposit_type
  return {
    require_approval: r.require_approval !== false,
    allow_custom_amount: !!r.allow_custom_amount,
    allow_products: r.allow_products !== false,
    deposit_type: dt === 'fixed' || dt === 'percent' ? dt : 'none',
    deposit_value: Math.max(0, Number(r.deposit_value) || 0),
    channels: { sms: ch.sms !== false, email: ch.email !== false, whatsapp: ch.whatsapp !== false },
  }
}

/** Is the payment_collection skill toggled on for this agent? */
export async function isPaymentCollectionActive(admin: SupabaseClient, agentId: string): Promise<boolean> {
  const { data } = await admin.from('skills').select('active').eq('ai_employee_id', agentId).eq('type', 'payment_collection').maybeSingle()
  return !!data?.active
}

/** Resolve the agent handling a conversation (or the tenant's first agent) + its settings. */
export async function resolvePaymentAgent(
  admin: SupabaseClient, tenantId: string, conversationId?: string | null,
): Promise<{ id: string; settings: PaymentCollectionSettings } | null> {
  let agentId: string | null = null
  if (conversationId) {
    const { data: c } = await admin.from('conversations').select('ai_employee_id').eq('id', conversationId).maybeSingle()
    agentId = (c?.ai_employee_id as string) || null
  }
  if (!agentId) {
    const { data: a } = await admin.from('ai_employees').select('id').eq('tenant_id', tenantId).order('created_at', { ascending: true }).limit(1).maybeSingle()
    agentId = (a?.id as string) || null
  }
  if (!agentId) return null
  const { data: agent } = await admin.from('ai_employees').select('id, payment_collection_settings').eq('id', agentId).maybeSingle()
  if (!agent) return null
  return { id: agent.id as string, settings: normalizePaymentSettings(agent.payment_collection_settings) }
}

/** Apply the deposit rule to a product's price. Returns the amount to charge (minor units)
 *  when a deposit applies, else null (charge the full product price as-is). */
export function computeDeposit(settings: PaymentCollectionSettings, priceUnitAmount: number | null): number | null {
  if (settings.deposit_type === 'fixed' && settings.deposit_value > 0) return Math.round(settings.deposit_value * 100)
  if (settings.deposit_type === 'percent' && settings.deposit_value > 0 && priceUnitAmount != null) {
    return Math.max(50, Math.round(priceUnitAmount * (settings.deposit_value / 100)))
  }
  return null
}

export interface CheckoutInput {
  tenantId: string
  businessName: string
  accountId: string
  appUrl: string
  priceId?: string | null       // charge a Stripe product price as-is
  amount?: number | null        // OR charge this exact amount (minor units) via price_data (custom/deposit)
  productName: string
  currency?: string
  recordAmount?: number | null  // amount to store on the payments row
  customerEmail?: string | null
  customerPhone?: string | null
  conversationId?: string | null
  contactId?: string | null
}

/** Create a Checkout Session on the CONNECTED account, record a pending payment, email the
 *  link. Shared by the direct (no-approval) path and the owner-approval path. */
export async function createConnectCheckout(admin: SupabaseClient, input: CheckoutInput): Promise<{ url: string; sessionId: string; emailed: boolean; productName: string }> {
  const currency = input.currency || 'usd'
  const line_item = input.amount != null
    ? { price_data: { currency, product_data: { name: input.productName }, unit_amount: input.amount }, quantity: 1 }
    : { price: input.priceId as string, quantity: 1 }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [line_item],
    customer_email: input.customerEmail || undefined,
    success_url: `${input.appUrl}/?payment=success`,
    cancel_url: `${input.appUrl}/?payment=cancelled`,
    metadata: { tenantId: input.tenantId, conversationId: input.conversationId || '', contactId: input.contactId || '', priceId: input.priceId || '' },
  }, { stripeAccount: input.accountId })

  await admin.from('payments').insert({
    tenant_id: input.tenantId,
    connected_account_id: input.accountId,
    checkout_session_id: session.id,
    price_id: input.priceId || null,
    product_name: input.productName,
    amount: input.recordAmount ?? input.amount ?? null,
    currency,
    customer_email: input.customerEmail || null,
    customer_phone: input.customerPhone || null,
    conversation_id: input.conversationId || null,
    contact_id: input.contactId || null,
    status: 'pending',
  })

  let emailed = false
  if (input.customerEmail && session.url) {
    try {
      // `emailed` is what the agent repeats back to the customer ("I've emailed you the link"), so it
      // has to mean the send succeeded — not merely that it didn't throw.
      emailed = (await sendEmail(
        input.customerEmail,
        `Your payment link from ${input.businessName}`,
        `<p>Here's your secure payment link for <strong>${input.productName}</strong>:</p><p><a href="${session.url}">${session.url}</a></p><p>— ${input.businessName}</p>`,
      )).success
    } catch { /* link is still returned for in-channel delivery */ }
  }
  return { url: session.url || '', sessionId: session.id, emailed, productName: input.productName }
}

/** Owner-facing summary of a payment_request amount. */
export function formatRequestAmount(amount: number | null, currency = 'usd'): string {
  if (amount == null) return 'product price'
  return `$${(amount / 100).toFixed(2)}${currency !== 'usd' ? ' ' + currency.toUpperCase() : ''}`
}
