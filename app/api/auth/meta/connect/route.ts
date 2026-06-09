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

  const oauthUrl = new URL('https://www.facebook.com/v21.0/dialog/oauth')
  oauthUrl.searchParams.set('client_id', appId)
  oauthUrl.searchParams.set('redirect_uri', redirectUri)
  oauthUrl.searchParams.set('scope', [
    'pages_manage_metadata',
    'pages_messaging',
    'instagram_basic',
    'instagram_manage_messages',
    'pages_read_engagement',
    'pages_show_list',
    'business_management',
  ].join(','))
  oauthUrl.searchParams.set('state', state)
  oauthUrl.searchParams.set('response_type', 'code')

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
