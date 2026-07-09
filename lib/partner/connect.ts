import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/server'

// Partner payouts via Stripe Connect EXPRESS accounts. This is SEPARATE from the tenant's
// Standard Connect account in lib/stripe/connect.ts (tenants collecting from THEIR customers).
// Here the platform pays partners: Express onboarding + transfers to the connected account.

export interface ExpressStatus {
  connected: boolean
  accountId?: string
  payoutsEnabled: boolean
  onboardingComplete: boolean
  configured: boolean
}

// Automatic payouts require BOTH a Stripe key AND Stripe Connect enabled on the platform account.
// Connect is opt-in via env so the UI degrades to a clean "manual payout" state instead of throwing
// raw Stripe errors when Connect isn't enabled yet.
export function isConnectConfigured(): boolean {
  return !!stripe && process.env.STRIPE_CONNECT_ENABLED === 'true'
}

/** Create the partner's Express account if missing; returns the account id. */
export async function getOrCreateExpressAccount(partnerId: string): Promise<string> {
  const db = createAdminClient()
  const { data: partner } = await db.from('partners').select('stripe_connect_express_id, contact_email').eq('id', partnerId).maybeSingle()
  if (partner?.stripe_connect_express_id) return partner.stripe_connect_express_id
  if (!stripe) throw new Error('Stripe is not configured.')
  const account = await stripe.accounts.create({
    type: 'express',
    email: partner?.contact_email || undefined,
    capabilities: { transfers: { requested: true } },
    business_type: 'individual',
    metadata: { partner_id: partnerId },
  })
  await db.from('partners').update({ stripe_connect_express_id: account.id }).eq('id', partnerId)
  return account.id
}

/** An onboarding link the partner follows to complete KYC + payout details. */
export async function createOnboardingLink(partnerId: string, returnUrl: string, refreshUrl: string): Promise<string> {
  if (!stripe) throw new Error('Stripe is not configured.')
  const accountId = await getOrCreateExpressAccount(partnerId)
  const link = await stripe.accountLinks.create({ account: accountId, return_url: returnUrl, refresh_url: refreshUrl, type: 'account_onboarding' })
  return link.url
}

/** Retrieve + persist the partner's Express payout status. Never throws — degrades to manual mode. */
export async function getExpressStatus(partnerId: string): Promise<ExpressStatus> {
  const configured = isConnectConfigured()
  if (!configured) return { connected: false, payoutsEnabled: false, onboardingComplete: false, configured: false }
  const db = createAdminClient()
  const { data: partner } = await db.from('partners').select('stripe_connect_express_id').eq('id', partnerId).maybeSingle()
  const accountId = partner?.stripe_connect_express_id
  if (!accountId || !stripe) return { connected: false, payoutsEnabled: false, onboardingComplete: false, configured }
  try {
    const acct = await stripe.accounts.retrieve(accountId)
    const payoutsEnabled = !!acct.payouts_enabled
    const onboardingComplete = !!acct.details_submitted
    await db.from('partners').update({ connect_payouts_enabled: payoutsEnabled, connect_onboarding_complete: onboardingComplete }).eq('id', partnerId)
    return { connected: true, accountId, payoutsEnabled, onboardingComplete, configured }
  } catch {
    return { connected: true, accountId, payoutsEnabled: false, onboardingComplete: false, configured }
  }
}

/** Sync a partner Express account's capability flags from an account.updated event. Returns true
 * if this account belongs to a partner (so the webhook knows it was handled). */
export async function syncPartnerConnectFromAccount(account: { id: string; payouts_enabled?: boolean; details_submitted?: boolean }): Promise<boolean> {
  const db = createAdminClient()
  const { data: partner } = await db.from('partners').select('id, connect_payouts_enabled').eq('stripe_connect_express_id', account.id).maybeSingle()
  if (!partner) return false
  const nowEnabled = !!account.payouts_enabled
  await db.from('partners').update({ connect_payouts_enabled: nowEnabled, connect_onboarding_complete: !!account.details_submitted }).eq('id', partner.id)
  if (nowEnabled && !partner.connect_payouts_enabled) {
    await db.from('partner_notifications').insert({ partner_id: partner.id, kind: 'payouts_enabled', title: 'Payouts are set up', body: 'Approved commissions will now be transferred to your account automatically.', link: '/partner/commissions' })
  }
  return true
}

/** A partner transfer failed/reversed: un-pay the bundled entries and mark the payout failed. */
export async function handlePartnerTransferFailure(transferId: string, reason: string): Promise<void> {
  const db = createAdminClient()
  const { data: payout } = await db.from('payouts').select('id, partner_id').eq('stripe_transfer_id', transferId).maybeSingle()
  if (!payout) return
  await db.from('commission_entries').update({ status: 'approved', paid_at: null, payout_id: null }).eq('payout_id', payout.id)
  await db.from('payouts').update({ status: 'failed', last_error: reason, updated_at: new Date().toISOString() }).eq('id', payout.id)
  await db.from('partner_notifications').insert({ partner_id: payout.partner_id, kind: 'payout_failed', title: 'Payout failed', body: 'We could not complete your payout — it will be retried automatically.', link: '/partner/commissions' })
}

export interface ConnectPayResult { ok: boolean; transferId?: string; error?: string }

/**
 * Transfer an approved payout to the partner's Express account. Returns { ok:false } (never throws)
 * so the caller can fall back to a manual payout record.
 */
export async function payPartnerViaConnect(partnerId: string, amountCents: number, currency: string): Promise<ConnectPayResult> {
  try {
    if (!stripe) return { ok: false, error: 'Stripe not configured' }
    const status = await getExpressStatus(partnerId)
    if (!status.connected || !status.payoutsEnabled || !status.accountId) return { ok: false, error: 'Partner payouts not enabled' }
    if (amountCents <= 0) return { ok: false, error: 'Nothing to transfer' }
    const transfer = await stripe.transfers.create({
      amount: amountCents, currency: currency.toLowerCase(), destination: status.accountId,
      metadata: { partner_id: partnerId },
    })
    return { ok: true, transferId: transfer.id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
