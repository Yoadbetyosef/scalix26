import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHmac, randomBytes } from 'crypto'
import { getProvider } from '@/lib/mailbox'
import { requestBaseUrl } from '@/lib/request-url'

// Mirrors /api/auth/meta/connect: signed state (HMAC) + CSRF nonce cookie, then
// redirect to the provider consent screen. Google → returns a refresh token.
export async function GET(req: NextRequest) {
  // Use the domain the user is actually on so redirect_uri matches in the callback.
  const baseUrl = requestBaseUrl(req)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${baseUrl}/auth/login`)

  const agentId = req.nextUrl.searchParams.get('agentId')
  if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })

  const secret = process.env.GOOGLE_CLIENT_SECRET
  if (!process.env.GOOGLE_CLIENT_ID || !secret) {
    return NextResponse.json({ error: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set' }, { status: 500 })
  }

  const nonce = randomBytes(16).toString('hex')
  const payloadB64 = Buffer.from(JSON.stringify({ agentId, nonce, userId: user.id })).toString('base64url')
  const sig = createHmac('sha256', secret).update(payloadB64).digest('hex')
  const state = `${payloadB64}.${sig}`

  const redirectUri = `${baseUrl}/api/auth/google/callback`
  const oauthUrl = getProvider('google').getAuthUrl({ state, redirectUri })

  const response = NextResponse.redirect(oauthUrl)
  response.cookies.set('google_oauth_nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
    sameSite: 'lax',
  })
  return response
}
