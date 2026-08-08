import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHmac, randomBytes } from 'crypto'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/auth/login`)

  const agentId = req.nextUrl.searchParams.get('agentId')
  if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })

  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) {
    return NextResponse.json({ error: 'META_APP_ID and META_APP_SECRET must be set' }, { status: 500 })
  }

  const nonce = randomBytes(16).toString('hex')
  const payloadB64 = Buffer.from(JSON.stringify({ agentId, nonce, userId: user.id })).toString('base64url')
  const sig = createHmac('sha256', appSecret).update(payloadB64).digest('hex')
  const state = `${payloadB64}.${sig}`

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
  const redirectUri = `${baseUrl}/api/auth/meta/callback`

  // ── FACEBOOK LOGIN FOR BUSINESS ────────────────────────────────────────────────────────────────
  //
  // This app is a Login-for-Business app, and that flow is driven by a CONFIGURATION created in the
  // Meta dashboard rather than by a scope list sent from here. Meta's documentation is explicit:
  //
  //   "config_id has replaced scope (which should not be used), the response_type has been set to
  //    code, since SUAT's require the authorization code grant type, and override_default_response_type
  //    must be set to true."
  //
  // Sending `scope` and no `config_id` is what produced "Feature Unavailable — Facebook Login is
  // currently unavailable for this app". It is an app-level refusal, so it blocked everyone including
  // app role-holders, and the Configurations tab being empty means this flow had never once worked for
  // any tenant since the app became Login for Business.
  //
  // override_default_response_type is NOT optional here. Without it the dialog can fall back to the
  // implicit grant, which system-user tokens do not support.
  const configId = process.env.META_CONFIG_ID
  if (!configId) {
    return NextResponse.json({ error: 'META_CONFIG_ID must be set — see lib/meta/scopes.ts' }, { status: 500 })
  }

  const oauthUrl = new URL('https://www.facebook.com/v21.0/dialog/oauth')
  oauthUrl.searchParams.set('client_id', appId)
  oauthUrl.searchParams.set('redirect_uri', redirectUri)
  oauthUrl.searchParams.set('config_id', configId)
  oauthUrl.searchParams.set('state', state)
  oauthUrl.searchParams.set('response_type', 'code')
  oauthUrl.searchParams.set('override_default_response_type', 'true')

  const response = NextResponse.redirect(oauthUrl.toString())
  response.cookies.set('meta_oauth_nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
    sameSite: 'lax',
  })
  return response
}
