import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'

// TEMPORARY diagnostic, OUTSIDE /api/admin so the admin middleware doesn't redirect it.
// Reports the detected session email/admin status AND — using the PRODUCTION Stripe key +
// client_id that this deployment actually runs with — the live Stripe account identity and
// whether the configured client_id belongs to that account. Non-secret facts only (account
// id/email/name are your own business; secret key is mode + last4). Remove after debugging.
//   /api/stripe-connect-debug

function mask(v: string): string {
  if (!v) return '(empty)'
  return v.length <= 10 ? v.slice(0, 3) + '…' : `${v.slice(0, 6)}…${v.slice(-4)}`
}
function maskEmail(e: string): string {
  const [u, d] = e.split('@'); return d ? `${u.slice(0, 2)}…@${d}` : mask(e)
}
function keyMode(k: string): string {
  if (k.startsWith('sk_live_') || k.startsWith('rk_live_')) return 'LIVE'
  if (k.startsWith('sk_test_') || k.startsWith('rk_test_')) return 'TEST'
  return k ? 'unknown' : '(not set)'
}

// Uses the PRODUCTION secret key + client_id in this deployment. Proves account identity and
// whether the account owns the client_id (via the oauth.deauthorize "No such application" test).
async function productionStripe() {
  const secret = process.env.STRIPE_SECRET_KEY || ''
  const clientId = (process.env.STRIPE_CONNECT_CLIENT_ID || '').trim()
  const out: Record<string, unknown> = {
    secret_key_source: 'Vercel production env (the key THIS deployment runs with)',
    secret_key_mode: keyMode(secret),
    secret_key_last4: secret ? secret.slice(-4) : null,
    configured_client_id_masked: clientId ? mask(clientId) : '(not set)',
  }
  try {
    // GET /v1/account returns the account the secret key belongs to (typed SDK retrieve needs an id).
    const r = await fetch('https://api.stripe.com/v1/account', { headers: { Authorization: `Bearer ${secret}` } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a: any = await r.json()
    if (a?.error) out.account_error = a.error.message
    else {
      out.account_id = a.id
      out.account_email = a.email || null
      out.account_display_name = a?.settings?.dashboard?.display_name || a?.business_profile?.name || null
    }
  } catch (e) {
    out.account_error = e instanceof Error ? e.message : String(e)
  }
  if (clientId) {
    try {
      await stripe.oauth.deauthorize({ client_id: clientId, stripe_user_id: 'acct_1InvalidDummyXX' })
      out.ownership = { client_id_belongs_to_this_account: true, note: 'deauthorize returned no client error' }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const clientRejected = /no such application|does not exist|invalid[_ ]?client|not owned/i.test(msg)
      out.ownership = {
        client_id_belongs_to_this_account: !clientRejected,
        stripe_error: msg,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        error_type: (e as any)?.type,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        http_status: (e as any)?.statusCode,
      }
    }
  }
  return out
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not logged in (no session cookie reached this route)' }, { status: 401 })

  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'yoadbetyosef@gmail.com').split(',').map((e) => e.trim())
  const email = user.email || ''
  const isAdmin = ADMIN_EMAILS.includes(email)

  const session = {
    detected_email: email,
    detected_user_id: user.id,
    is_admin: isAdmin,
    ADMIN_EMAILS_source: process.env.ADMIN_EMAILS ? 'env var ADMIN_EMAILS (overridden)' : 'code default (yoadbetyosef@gmail.com)',
    ADMIN_EMAILS_masked: ADMIN_EMAILS.map(maskEmail),
    why_admin_area_redirects: isAdmin
      ? 'your email IS admin — the admin area should not redirect you'
      : 'your email is NOT in ADMIN_EMAILS → middleware sends /admin and /api/admin to /dashboard.',
  }

  // Production Stripe identity + ownership — the authoritative production answer.
  const production_stripe = await productionStripe()

  return NextResponse.json({
    session,
    production_stripe,
    how_to_read: 'Compare production_stripe.account_id/email/display_name to your Stripe dashboard. If ownership.client_id_belongs_to_this_account is false, the configured client_id is not an application of this account (wrong value or wrong test/live mode).',
  })
}
