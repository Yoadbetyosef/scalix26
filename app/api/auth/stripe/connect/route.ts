import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHmac, randomBytes } from 'crypto'
import { connectAuthorizeUrl } from '@/lib/stripe/connect'
import { requestBaseUrl } from '@/lib/request-url'

// Start Stripe Connect (Standard) OAuth. Mirrors the Gmail/Outlook connect flow:
// signed HMAC state + CSRF nonce cookie, then redirect to Stripe's consent screen.
// The tenant connects THEIR OWN Stripe account; we never hold funds (no app fee).
export async function GET(req: NextRequest) {
  const baseUrl = requestBaseUrl(req)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${baseUrl}/auth/login`)

  const agentId = req.nextUrl.searchParams.get('agentId') || ''

  // Not configured → redirect back with a clear error param (never a raw JSON dead page).
  const secret = process.env.STRIPE_SECRET_KEY
  if (!process.env.STRIPE_CONNECT_CLIENT_ID || !secret) {
    const back = agentId ? `${baseUrl}/ai-employees/${agentId}` : `${baseUrl}/ai-employees`
    return NextResponse.redirect(`${back}?stripe_error=not_configured`)
  }

  const nonce = randomBytes(16).toString('hex')
  const payloadB64 = Buffer.from(JSON.stringify({ agentId, nonce, userId: user.id })).toString('base64url')
  const sig = createHmac('sha256', secret).update(payloadB64).digest('hex')
  const state = `${payloadB64}.${sig}`

  const redirectUri = `${baseUrl}/api/auth/stripe/callback`
  const oauthUrl = connectAuthorizeUrl(state, redirectUri)

  const response = NextResponse.redirect(oauthUrl)
  response.cookies.set('sconnect_oauth_nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
    sameSite: 'lax',
  })
  return response
}
