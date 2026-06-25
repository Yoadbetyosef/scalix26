import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHmac, randomBytes } from 'crypto'
import { getMicrosoftCalendarAuthUrl } from '@/lib/calendar/microsoft'
import { requestBaseUrl } from '@/lib/request-url'

// Connect Outlook/Microsoft Calendar. Mirrors the Google Calendar connect flow (signed
// HMAC state + CSRF nonce cookie) but requests Calendars.ReadWrite via the existing Azure
// app and stores a SEPARATE grant (connected_calendars, provider='microsoft'). Does not
// touch the Outlook email connection or any Google connection.
export async function GET(req: NextRequest) {
  const baseUrl = requestBaseUrl(req)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${baseUrl}/auth/login`)

  // agentId is only the page to return to after consent.
  const agentId = req.nextUrl.searchParams.get('agentId') || ''

  const secret = process.env.MICROSOFT_CLIENT_SECRET
  if (!process.env.MICROSOFT_CLIENT_ID || !secret) {
    return NextResponse.json({ error: 'MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set' }, { status: 500 })
  }

  const nonce = randomBytes(16).toString('hex')
  const payloadB64 = Buffer.from(JSON.stringify({ agentId, nonce, userId: user.id })).toString('base64url')
  const sig = createHmac('sha256', secret).update(payloadB64).digest('hex')
  const state = `${payloadB64}.${sig}`

  const redirectUri = `${baseUrl}/api/auth/microsoft/calendar/callback`
  const oauthUrl = getMicrosoftCalendarAuthUrl({ state, redirectUri })

  const response = NextResponse.redirect(oauthUrl)
  response.cookies.set('mscal_oauth_nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
    sameSite: 'lax',
  })
  return response
}
