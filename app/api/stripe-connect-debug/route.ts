import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// TEMPORARY diagnostic, deliberately placed OUTSIDE /api/admin so the admin middleware
// (which redirects non-admin sessions to /dashboard) does NOT intercept it. It reports the
// DETECTED session email + whether that email counts as admin — so we can see why the admin
// area bounces you. Stripe env facts (masked, never full secrets) are shown only to admins.
// Reads only; changes nothing. Remove after debugging.
//   /api/stripe-connect-debug?expected=ca_Uo2VZajX32ITUq9A1ICJ1ru0PoR6sNZq

function mask(v: string): string {
  if (!v) return '(empty)'
  return v.length <= 10 ? v.slice(0, 3) + '…' : `${v.slice(0, 6)}…${v.slice(-4)}`
}
function maskEmail(e: string): string {
  const [u, d] = e.split('@')
  if (!d) return mask(e)
  return `${u.slice(0, 2)}…@${d}`
}
function keyMode(k: string): string {
  if (!k) return '(not set)'
  if (k.startsWith('sk_live_') || k.startsWith('rk_live_')) return 'LIVE'
  if (k.startsWith('sk_test_') || k.startsWith('rk_test_')) return 'TEST'
  return 'unknown'
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not logged in (no session cookie reached this route)' }, { status: 401 })

  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'yoadbetyosef@gmail.com').split(',').map((e) => e.trim())
  const email = user.email || ''
  const isAdmin = ADMIN_EMAILS.includes(email)

  const sessionDiag = {
    detected_email: email, // your own email — shown so you can see exactly what the app sees
    detected_user_id: user.id,
    is_admin: isAdmin,
    ADMIN_EMAILS_source: process.env.ADMIN_EMAILS ? 'env var ADMIN_EMAILS (overridden)' : 'code default (yoadbetyosef@gmail.com)',
    ADMIN_EMAILS_count: ADMIN_EMAILS.length,
    ADMIN_EMAILS_masked: ADMIN_EMAILS.map(maskEmail),
    why_admin_area_redirects: isAdmin
      ? 'your email IS admin — the admin area should NOT redirect you'
      : 'your email is NOT in ADMIN_EMAILS → middleware redirects /admin and /api/admin to /dashboard. Fix: add this email to the Vercel ADMIN_EMAILS env var (or log in as an admin email), then redeploy.',
  }

  if (!isAdmin) {
    return NextResponse.json({
      session: sessionDiag,
      stripe: 'hidden — visible only to an admin email. Resolve the admin-email issue above first.',
    })
  }

  // Admin → full Stripe Connect env diagnosis.
  const raw = process.env.STRIPE_CONNECT_CLIENT_ID || ''
  const trimmed = raw.trim()
  const expected = (new URL(req.url).searchParams.get('expected') || '').trim()
  const secret = process.env.STRIPE_SECRET_KEY || ''
  const secretMode = keyMode(secret)

  let matchesExpected: boolean | null = null
  let firstDiffIndex: number | null = null
  if (expected) {
    matchesExpected = trimmed === expected
    if (!matchesExpected) {
      const n = Math.max(trimmed.length, expected.length)
      for (let i = 0; i < n; i++) if (trimmed[i] !== expected[i]) { firstDiffIndex = i; break }
    }
  }

  const redirectUri = 'https://app.scalix26.com/api/auth/stripe/callback'
  const url = new URL('https://connect.stripe.com/oauth/authorize')
  if (trimmed) {
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', trimmed)
    url.searchParams.set('scope', 'read_write')
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', 'DEBUG')
  }
  const authorizeUrl = trimmed ? url.toString().replace(encodeURIComponent(trimmed), mask(trimmed)) : '(client_id not set)'

  return NextResponse.json({
    session: sessionDiag,
    stripe_connect_client_id: {
      set: !!raw,
      masked: mask(trimmed),
      startsWith_ca: trimmed.startsWith('ca_'),
      rawLength: raw.length,
      trimmedLength: trimmed.length,
      hasSurroundingWhitespace: raw !== trimmed,
    },
    match_vs_expected: expected
      ? { expectedMasked: mask(expected), matchesExpected, firstDiffIndex }
      : 'pass ?expected=ca_… to compare against your dashboard value',
    stripe_secret_key: { set: !!secret, mode: secretMode, last4: secret ? secret.slice(-4) : null },
    stripe_connect_webhook_secret_set: !!process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    generated_oauth_authorize_url: authorizeUrl,
    interpretation: [
      !raw ? 'client_id NOT set in this deployment → env not applied / not redeployed.' : null,
      raw && raw !== trimmed ? 'client_id has surrounding whitespace → THIS causes "No application matches". Trim fix is deployed; also clean the Vercel value.' : null,
      expected && matchesExpected === false ? `Production client_id ≠ your dashboard value (first diff at index ${firstDiffIndex}) → fix the Vercel env var.` : null,
      expected && matchesExpected === true ? 'Production client_id EXACTLY matches your dashboard value.' : null,
      secretMode === 'TEST' ? 'STRIPE_SECRET_KEY is TEST mode — a LIVE client_id with a TEST secret is a mode mismatch.' : null,
    ].filter(Boolean),
  })
}
