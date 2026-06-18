import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHmac } from 'crypto'
import { exchangeCalendarCode, listCalendars } from '@/lib/calendar/google'
import { saveCalendar, resolveOwnerTenantId } from '@/lib/calendar/store'
import { requestBaseUrl } from '@/lib/request-url'

// Google Calendar OAuth callback. Verifies HMAC state + CSRF nonce + session,
// exchanges the code, stores the grant encrypted in connected_calendars (default
// calendar = primary). Never logs tokens. Mirrors the Gmail callback.
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
  const expectedSig = createHmac('sha256', process.env.GOOGLE_CLIENT_SECRET!).update(payloadB64).digest('hex')
  if (sig !== expectedSig) return NextResponse.redirect(back('', 'calendar_error=invalid_state'))

  let payload: { agentId: string; nonce: string; userId: string }
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
  } catch {
    return NextResponse.redirect(back('', 'calendar_error=invalid_state'))
  }

  const cookieNonce = req.cookies.get('gcal_oauth_nonce')?.value
  if (!cookieNonce || cookieNonce !== payload.nonce) {
    return NextResponse.redirect(back(payload.agentId, 'calendar_error=invalid_state'))
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== payload.userId) return NextResponse.redirect(`${baseUrl}/auth/login`)

  const clearNonce = (res: NextResponse) => { res.cookies.set('gcal_oauth_nonce', '', { maxAge: 0, path: '/' }); return res }

  try {
    const tenantId = await resolveOwnerTenantId(user.id)
    if (!tenantId) return clearNonce(NextResponse.redirect(back(payload.agentId, 'calendar_error=no_tenant')))

    const redirectUri = `${baseUrl}/api/auth/google/calendar/callback`
    const tokens = await exchangeCalendarCode({ code, redirectUri })
    console.log('[calendar/callback] token exchange OK | email', tokens.email, '| refresh?', !!tokens.refreshToken)

    // Default to the primary calendar; capture its name for display (best-effort).
    let calendarSummary: string | null = null
    try {
      const cals = await listCalendars(tokens.accessToken)
      calendarSummary = cals.find((c) => c.primary)?.summary || null
    } catch { /* picker still works later via /api/calendar/status */ }

    await saveCalendar({ tenantId, tokens, calendarId: 'primary', calendarSummary })
    console.log('[calendar/callback] connected calendar for tenant', tenantId)

    return clearNonce(NextResponse.redirect(back(payload.agentId, 'calendar_connected=true')))
  } catch (err) {
    console.error('[calendar/callback] connect FAILED:', err instanceof Error ? err.message : err)
    return clearNonce(NextResponse.redirect(back(payload.agentId, 'calendar_error=token_failed')))
  }
}
