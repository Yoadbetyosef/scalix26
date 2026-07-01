import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/server'

// Stripe Connect (Standard accounts, OAuth). Tenants connect THEIR OWN Stripe account;
// every charge goes directly to them — NO application fee, we never touch customer funds.
// Reuses the platform `stripe` client; each connected-account call passes
// { stripeAccount } so it acts on the tenant's account. Platform billing is untouched.

export const CONNECT_SCOPE = 'read_write'

function connectClientId(): string {
  // Trim defensively — a pasted newline/space in the env var would otherwise be sent to
  // Stripe in the OAuth URL and trigger "No application matches the supplied client identifier".
  const id = process.env.STRIPE_CONNECT_CLIENT_ID?.trim()
  if (!id) throw new Error('STRIPE_CONNECT_CLIENT_ID is not set')
  return id
}

export function connectAuthorizeUrl(state: string, redirectUri: string): string {
  const url = new URL('https://connect.stripe.com/oauth/authorize')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', connectClientId())
  url.searchParams.set('scope', CONNECT_SCOPE)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

export async function exchangeConnectCode(code: string): Promise<string> {
  const r = await stripe.oauth.token({ grant_type: 'authorization_code', code })
  const acct = r.stripe_user_id
  if (!acct) throw new Error('no stripe_user_id returned from oauth token')
  return acct
}

// Onboarding/capability flags read off a Stripe Account (Standard). details_submitted =
// the tenant finished Stripe's onboarding; charges/payouts_enabled = account is live.
interface ConnectFlags { charges_enabled: boolean; payouts_enabled: boolean; onboarding_complete: boolean }
function accountFlags(a: Stripe.Account): ConnectFlags {
  return { charges_enabled: !!a.charges_enabled, payouts_enabled: !!a.payouts_enabled, onboarding_complete: !!a.details_submitted }
}
async function fetchFlags(accountId: string): Promise<ConnectFlags | null> {
  try { return accountFlags(await stripe.accounts.retrieve(accountId)) } catch { return null }
}

export async function saveConnectedAccount(tenantId: string, accountId: string): Promise<void> {
  const supabase = createAdminClient()
  const flags = await fetchFlags(accountId) // best-effort — never lose the connection if this fails
  const update: Record<string, unknown> = {
    stripe_connect_account_id: accountId,
    stripe_connect_status: flags ? (flags.charges_enabled ? 'connected' : 'restricted') : 'connected',
  }
  if (flags) {
    update.stripe_connect_charges_enabled = flags.charges_enabled
    update.stripe_connect_payouts_enabled = flags.payouts_enabled
    update.stripe_connect_onboarding_complete = flags.onboarding_complete
  }
  const { error } = await supabase.from('tenants').update(update).eq('id', tenantId)
  if (error) throw new Error('save connected account failed: ' + error.message)
}

// Keep the tenant's connect capability flags in sync from a webhook account.updated event.
export async function syncConnectFromAccount(account: Stripe.Account): Promise<void> {
  const supabase = createAdminClient()
  const f = accountFlags(account)
  await supabase.from('tenants').update({
    stripe_connect_status: f.charges_enabled ? 'connected' : 'restricted',
    stripe_connect_charges_enabled: f.charges_enabled,
    stripe_connect_payouts_enabled: f.payouts_enabled,
    stripe_connect_onboarding_complete: f.onboarding_complete,
  }).eq('stripe_connect_account_id', account.id)
}

// Connected account id for a tenant (only when status='connected'), else null.
export async function getConnectedAccountId(tenantId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('tenants')
    .select('stripe_connect_account_id, stripe_connect_status').eq('id', tenantId).maybeSingle()
  if (!data || data.stripe_connect_status !== 'connected') return null
  return data.stripe_connect_account_id || null
}

export async function disconnectAccount(tenantId: string): Promise<void> {
  const supabase = createAdminClient()
  // Read the account id directly (deauthorize even a 'restricted' account, not only 'connected').
  const { data } = await supabase.from('tenants').select('stripe_connect_account_id').eq('id', tenantId).maybeSingle()
  const acct = data?.stripe_connect_account_id as string | null
  if (acct) {
    try {
      await stripe.oauth.deauthorize({ client_id: connectClientId(), stripe_user_id: acct })
    } catch (e) {
      console.warn('[stripe-connect] deauthorize failed (clearing anyway):', e instanceof Error ? e.message : e)
    }
  }
  await supabase.from('tenants').update({
    stripe_connect_account_id: null, stripe_connect_status: null,
    stripe_connect_charges_enabled: false, stripe_connect_payouts_enabled: false, stripe_connect_onboarding_complete: false,
  }).eq('id', tenantId)
}

export interface ConnectStatus { connected: boolean; accountId?: string; email?: string | null; chargesEnabled?: boolean; payoutsEnabled?: boolean; onboardingComplete?: boolean }

// Status for the UI. Connection is based on a stored account id (so a 'restricted' account
// still reads as connected); capability flags come from the persisted columns. Email is a
// best-effort live lookup only.
export async function getConnectStatus(tenantId: string): Promise<ConnectStatus> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('tenants')
    .select('stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_onboarding_complete')
    .eq('id', tenantId).maybeSingle()
  const acct = data?.stripe_connect_account_id as string | undefined
  if (!acct) return { connected: false }
  let email: string | null | undefined
  try { email = (await stripe.accounts.retrieve(acct)).email } catch { email = undefined }
  return {
    connected: true, accountId: acct, email,
    chargesEnabled: !!data?.stripe_connect_charges_enabled,
    payoutsEnabled: !!data?.stripe_connect_payouts_enabled,
    onboardingComplete: !!data?.stripe_connect_onboarding_complete,
  }
}

export interface CatalogItem { priceId: string; productName: string; unitAmount: number | null; currency: string; recurring: string | null }

// The tenant's active products/prices, read from THEIR connected account.
export async function listCatalog(accountId: string): Promise<CatalogItem[]> {
  const prices = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] }, { stripeAccount: accountId })
  const out: CatalogItem[] = []
  for (const p of prices.data) {
    if (!p.active || typeof p.product !== 'object' || p.product === null) continue
    const product = p.product as Stripe.Product
    if (product.deleted || product.active === false) continue
    out.push({
      priceId: p.id,
      productName: product.name || 'Product',
      unitAmount: p.unit_amount ?? null,
      currency: p.currency,
      recurring: p.recurring ? p.recurring.interval : null,
    })
  }
  return out
}

// Guard: only ever charge a price that really belongs to the tenant's account.
export async function priceBelongsToAccount(accountId: string, priceId: string): Promise<boolean> {
  try {
    const p = await stripe.prices.retrieve(priceId, {}, { stripeAccount: accountId })
    return !!p && p.active !== false
  } catch {
    return false
  }
}

// Small in-memory cache so injecting the catalog into the prompt doesn't hit Stripe on
// every message. Per-process, short TTL — fine for a fail-safe prompt enrichment.
const catalogCache = new Map<string, { at: number; line: string }>()
const CATALOG_TTL_MS = 60_000

function formatAmount(i: CatalogItem): string {
  if (i.unitAmount == null) return 'variable price'
  const amt = `$${(i.unitAmount / 100).toFixed(2)}`
  return i.recurring ? `${amt}/${i.recurring}` : amt
}

// Prompt block listing the tenant's real products so the AI can offer them and pass the
// EXACT price_id to send_payment_link. Returns '' when not connected / no catalog / error.
export async function catalogPromptLine(tenantId: string): Promise<string> {
  const acct = await getConnectedAccountId(tenantId)
  if (!acct) return ''
  const cached = catalogCache.get(acct)
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.line
  try {
    const items = await listCatalog(acct)
    const line = items.length
      ? `PAYMENTS: You can send the customer a secure payment link for these products (call send_payment_link with the EXACT price_id — never invent one):\n${items.map((i) => `- ${i.productName} — ${formatAmount(i)} [price_id: ${i.priceId}]`).join('\n')}`
      : ''
    catalogCache.set(acct, { at: Date.now(), line })
    return line
  } catch (e) {
    console.warn('[stripe-connect] catalog fetch failed (skipping prompt injection):', e instanceof Error ? e.message : e)
    return ''
  }
}
