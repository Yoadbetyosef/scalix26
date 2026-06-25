import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHmac, randomBytes } from 'crypto'
import { getProvider } from '@/lib/mailbox'
import { requestBaseUrl } from '@/lib/request-url'

// Mirror of /api/auth/google/connect for Microsoft Graph: signed state (HMAC) + CSRF
// nonce cookie, then redirect to the Microsoft consent screen (returns a refresh token).
export async function GET(req: NextRequest) {
  // Use the domain the user is actually on so redirect_uri matches in the callback.
  const baseUrl = requestBaseUrl(req)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${baseUrl}/auth/login`)

  const agentId = req.nextUrl.searchParams.get('agentId')
  if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })

  const secret = process.env.MICROSOFT_CLIENT_SECRET
  if (!process.env.MICROSOFT_CLIENT_ID || !secret) {
    return NextResponse.json({ error: 'MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set' }, { status: 500 })
  }

  const nonce = randomBytes(16).toString('hex')
  const payloadB64 = Buffer.from(JSON.stringify({ agentId, nonce, userId: user.id })).toString('base64url')
  const sig = createHmac('sha256', secret).update(payloadB64).digest('hex')
  const state = `${payloadB64}.${sig}`

  const redirectUri = `${baseUrl}/api/auth/microsoft/callback`
  const oauthUrl = getProvider('microsoft').getAuthUrl({ state, redirectUri })

  const response = NextResponse.redirect(oauthUrl)
  response.cookies.set('ms_oauth_nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
    sameSite: 'lax',
  })
  return response
}
