import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHmac } from 'crypto'
import { exchangeMicrosoftCalendarCode } from '@/lib/calendar/microsoft'
import { saveCalendar, resolveOwnerTenantId } from '@/lib/calendar/store'
import { requestBaseUrl } from '@/lib/request-url'

// Outlook/Microsoft Calendar OAuth callback. Mirrors the Google Calendar callback:
// verify HMAC state + CSRF nonce + session, exchange the code, store the grant encrypted
// in connected_calendars (provider='microsoft'). v1 uses the user's DEFAULT calendar
// (no picker). Reuses the calendar_connected / calendar_error return params.
export async function GET(req: NextRequest) {
  const baseUrl = requestBaseUrl(req)
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const oauthError = req.nextUrl.searchParams.get('error')

  const back = (agentId: string, q: string) => agentId ? `${baseUrl}/ai-employees/${agentId}?${q}` : `${baseUrl}/ai-employees?${q}`

  if (oauthError || !code || !state) {
    return NextResponse.redirect(back('', 'calendar_error=cancelled'))
  }

  const dotIdx = state.lastIndexOf('.')
  if (dotIdx === -1) return NextResponse.redirect(back('', 'calendar_error=invalid_state'))
  const payloadB64 = state.slice(0, dotIdx)
  const sig = state.slice(dotIdx + 1)
  const expectedSig = createHmac('sha256', process.env.MICROSOFT_CLIENT_SECRET!).update(payloadB64).digest('hex')
  if (sig !== expectedSig) return NextResponse.redirect(back('', 'calendar_error=invalid_state'))

  let payload: { agentId: string; nonce: string; userId: string }
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
  } catch {
    return NextResponse.redirect(back('', 'calendar_error=invalid_state'))
  }

  const cookieNonce = req.cookies.get('mscal_oauth_nonce')?.value
  if (!cookieNonce || cookieNonce !== payload.nonce) {
    return NextResponse.redirect(back(payload.agentId, 'calendar_error=invalid_state'))
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== payload.userId) return NextResponse.redirect(`${baseUrl}/auth/login`)

  const clearNonce = (res: NextResponse) => { res.cookies.set('mscal_oauth_nonce', '', { maxAge: 0, path: '/' }); return res }

  try {
    const tenantId = await resolveOwnerTenantId(user.id)
    if (!tenantId) return clearNonce(NextResponse.redirect(back(payload.agentId, 'calendar_error=no_tenant')))

    const redirectUri = `${baseUrl}/api/auth/microsoft/calendar/callback`
    const tokens = await exchangeMicrosoftCalendarCode({ code, redirectUri })
    console.log('[ms-calendar/callback] token exchange OK | email', tokens.email, '| refresh?', !!tokens.refreshToken)

    await saveCalendar({ tenantId, provider: 'microsoft', tokens, calendarId: 'primary', calendarSummary: tokens.email || null })
    console.log('[ms-calendar/callback] connected calendar for tenant', tenantId)

    return clearNonce(NextResponse.redirect(back(payload.agentId, 'calendar_connected=true')))
  } catch (err) {
    console.error('[ms-calendar/callback] connect FAILED:', err instanceof Error ? err.message : err)
    return clearNonce(NextResponse.redirect(back(payload.agentId, 'calendar_error=token_failed')))
  }
}
