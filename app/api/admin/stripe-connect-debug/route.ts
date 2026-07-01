import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin/auth'

// TEMPORARY admin-only diagnostic for the Stripe Connect OAuth "No application matches the
// supplied client identifier" error. Reads the REAL production env at runtime and reports
// masked facts — never full secrets. Remove after debugging. Reads only; changes nothing.
//
// Usage (logged in as an admin email):
//   /api/admin/stripe-connect-debug?expected=ca_Uo2VZajX32ITUq9A1ICJ1ru0PoR6sNZq

function mask(v: string): string {
  if (!v) return '(empty)'
  return v.length <= 10 ? v.slice(0, 3) + '…' : `${v.slice(0, 6)}…${v.slice(-4)}`
}
function keyMode(k: string): string {
  if (!k) return '(not set)'
  if (k.startsWith('sk_live_') || k.startsWith('rk_live_')) return 'LIVE'
  if (k.startsWith('sk_test_') || k.startsWith('rk_test_')) return 'TEST'
  return 'unknown'
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })

  const raw = process.env.STRIPE_CONNECT_CLIENT_ID || ''
  const trimmed = raw.trim()
  const expected = (new URL(req.url).searchParams.get('expected') || '').trim()
  const secret = process.env.STRIPE_SECRET_KEY || ''
  const secretMode = keyMode(secret)

  // Exact comparison to the value you pasted from the Stripe dashboard.
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
  // Exactly how the code builds it (URLSearchParams encodes the value), using the trimmed id.
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
    checkedAt: new Date().toISOString(),
    stripe_connect_client_id: {
      set: !!raw,
      masked: mask(trimmed),
      startsWith_ca: trimmed.startsWith('ca_'),
      rawLength: raw.length,
      trimmedLength: trimmed.length,
      hasSurroundingWhitespace: raw !== trimmed, // ← a trailing newline/space is a common cause
    },
    match_vs_expected: expected
      ? { expectedMasked: mask(expected), expectedLength: expected.length, matchesExpected, firstDiffIndex }
      : 'pass ?expected=ca_… to compare against your dashboard value',
    stripe_secret_key: { set: !!secret, mode: secretMode, last4: secret ? secret.slice(-4) : null },
    stripe_connect_webhook_secret_set: !!process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    generated_oauth_authorize_url: authorizeUrl,
    redirect_uri_sent: redirectUri,
    interpretation: [
      !raw ? 'client_id NOT set in this deployment → env not applied / not redeployed.' : null,
      raw && raw !== trimmed ? 'client_id has surrounding whitespace → THIS causes "No application matches". The trim fix handles it; also clean the Vercel value.' : null,
      expected && matchesExpected === false ? `Production client_id does NOT equal your dashboard value (first difference at index ${firstDiffIndex}) → fix the Vercel env var.` : null,
      expected && matchesExpected === true ? 'Production client_id EXACTLY matches your dashboard value → the value is correct; if Stripe still errors, verify the client_id and STRIPE_SECRET_KEY belong to the SAME Stripe account and that OAuth is enabled in that account.' : null,
      secretMode === 'TEST' ? 'STRIPE_SECRET_KEY is TEST mode: the callback token-exchange runs in test mode. A LIVE client_id with a TEST secret is a mode mismatch.' : null,
    ].filter(Boolean),
  })
}
