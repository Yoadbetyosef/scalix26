import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { createHmac, randomBytes } from 'crypto'

// Admin-only Meta connect for the App Review screencast. Mirrors the production
// /api/auth/meta/connect flow — same HMAC state, same nonce cookie, same shared callback — so the
// recording reflects the app's real Facebook-Login / Messenger-API-for-Instagram implementation.
// Kept as a separate admin route only so the demo page can drive it.
//
// The scopes are IMPORTED, not restated. This route used to hold its own copy of the list with a
// comment promising it was the same as production's; both copies then asked for two permissions that
// were never submitted to Meta, and the promise was the only thing keeping them together. A demo of
// the integration that requests permissions the integration does not have is worse than no demo.
// See lib/meta/scopes.ts.

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard`)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/auth/login`)

  const agentId = req.nextUrl.searchParams.get('agentId')
  if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })

  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) return NextResponse.json({ error: 'META_APP_ID and META_APP_SECRET must be set' }, { status: 500 })

  const nonce = randomBytes(16).toString('hex')
  const payloadB64 = Buffer.from(JSON.stringify({ agentId, nonce, userId: user.id })).toString('base64url')
  const sig = createHmac('sha256', appSecret).update(payloadB64).digest('hex')
  const state = `${payloadB64}.${sig}`

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
  // Same Login-for-Business shape as production — see app/api/auth/meta/connect/route.ts. This route
  // exists to SHOW Meta the real integration, so a demo that used the old scope-based dialog would be
  // demonstrating a flow the app no longer has.
  const configId = process.env.META_CONFIG_ID
  if (!configId) return NextResponse.json({ error: 'META_CONFIG_ID must be set' }, { status: 500 })

  const oauthUrl = new URL('https://www.facebook.com/v21.0/dialog/oauth')
  oauthUrl.searchParams.set('client_id', appId)
  // The SHARED production callback, deliberately: the demo must exercise the real one.
  oauthUrl.searchParams.set('redirect_uri', `${baseUrl}/api/auth/meta/callback`)
  oauthUrl.searchParams.set('config_id', configId)
  oauthUrl.searchParams.set('state', state)
  oauthUrl.searchParams.set('response_type', 'code')
  oauthUrl.searchParams.set('override_default_response_type', 'true')

  const response = NextResponse.redirect(oauthUrl.toString())
  response.cookies.set('meta_oauth_nonce', nonce, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 600, path: '/', sameSite: 'lax',
  })
  return response
}
