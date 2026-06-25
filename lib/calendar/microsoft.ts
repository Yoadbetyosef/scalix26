// Microsoft 365 / Outlook Calendar OAuth + write API. Reuses the SAME Azure app as the
// Outlook email connection (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET) but a SEPARATE
// calendar grant (connected_calendars, provider='microsoft') with the Calendars.ReadWrite
// scope — existing email grants are never touched. Mirrors lib/calendar/google.ts so the
// store/book layers can dispatch by provider. v1 writes to the user's default calendar.
import type { CalendarTokens, CalendarEventInput } from './google'

const SCOPES = ['Calendars.ReadWrite', 'offline_access', 'openid', 'email']
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const GRAPH = 'https://graph.microsoft.com/v1.0'

function clientId() {
  const id = process.env.MICROSOFT_CLIENT_ID
  if (!id) throw new Error('MICROSOFT_CLIENT_ID is not set')
  return id
}
function clientSecret() {
  const s = process.env.MICROSOFT_CLIENT_SECRET
  if (!s) throw new Error('MICROSOFT_CLIENT_SECRET is not set')
  return s
}

export function getMicrosoftCalendarAuthUrl({ state, redirectUri }: { state: string; redirectUri: string }): string {
  const url = new URL(`${AUTHORITY}/authorize`)
  url.searchParams.set('client_id', clientId())
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('response_mode', 'query')
  url.searchParams.set('scope', SCOPES.join(' '))
  url.searchParams.set('prompt', 'consent') // refresh token + explicit consent
  url.searchParams.set('state', state)
  return url.toString()
}

export async function exchangeMicrosoftCalendarCode({ code, redirectUri }: { code: string; redirectUri: string }): Promise<CalendarTokens> {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: SCOPES.join(' '),
    }),
  })
  if (!res.ok) throw new Error(`microsoft calendar token exchange failed: ${res.status}`)
  const data = await res.json()

  let email = ''
  try {
    const u = await fetch(`${GRAPH}/me`, { headers: { Authorization: `Bearer ${data.access_token}` } })
    if (u.ok) { const j = await u.json(); email = String(j.mail || j.userPrincipalName || '').toLowerCase() }
  } catch { /* email is cosmetic — never block on it */ }

  return {
    email,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    scopes: data.scope || SCOPES.join(' '),
  }
}

export async function refreshMicrosoftCalendarToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: SCOPES.join(' '),
    }),
  })
  if (!res.ok) throw new Error(`microsoft calendar token refresh failed: ${res.status}`)
  const data = await res.json()
  return { accessToken: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 }
}

// Create an event on the user's DEFAULT calendar (v1 — no calendar picker). Graph
// accepts IANA time-zone names in start/end.timeZone (same format Google uses).
export async function createMicrosoftCalendarEvent(accessToken: string, event: CalendarEventInput): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH}/me/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: event.summary,
      body: { contentType: 'text', content: event.description || '' },
      start: { dateTime: event.start.dateTime, timeZone: event.start.timeZone },
      end: { dateTime: event.end.dateTime, timeZone: event.end.timeZone },
    }),
  })
  if (!res.ok) throw new Error(`microsoft calendar event create failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return { id: String(data.id) }
}
