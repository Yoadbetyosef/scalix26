// Google Calendar OAuth + write API (Phase 3a). Reuses the SAME Google OAuth
// client as the Gmail connection (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — the
// "Scalix AI" app), but its grant is stored separately (connected_calendars) so
// existing email grants are never touched. Minimal scopes: create events + read
// the calendar list (for the picker).

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',    // create/manage events
  'https://www.googleapis.com/auth/calendar.readonly',  // list calendars for the picker
  'openid',
  'email',
]

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CAL_API = 'https://www.googleapis.com/calendar/v3'

function clientId() {
  const id = process.env.GOOGLE_CLIENT_ID
  if (!id) throw new Error('GOOGLE_CLIENT_ID is not set')
  return id
}
function clientSecret() {
  const s = process.env.GOOGLE_CLIENT_SECRET
  if (!s) throw new Error('GOOGLE_CLIENT_SECRET is not set')
  return s
}

export interface CalendarTokens {
  email: string
  accessToken: string
  refreshToken: string | null
  expiresAt: number
  scopes: string
}

export function getCalendarAuthUrl({ state, redirectUri }: { state: string; redirectUri: string }): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId())
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline') // refresh token
  url.searchParams.set('prompt', 'consent')      // force refresh token on re-consent
  url.searchParams.set('include_granted_scopes', 'true') // incremental — keeps Gmail scopes
  url.searchParams.set('state', state)
  return url.toString()
}

export async function exchangeCalendarCode({ code, redirectUri }: { code: string; redirectUri: string }): Promise<CalendarTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`calendar token exchange failed: ${res.status}`)
  const data = await res.json()

  let email = ''
  try {
    const u = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${data.access_token}` } })
    if (u.ok) { const j = await u.json(); email = String(j.email || '').toLowerCase() }
  } catch { /* email is cosmetic — never block on it */ }

  return {
    email,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    scopes: data.scope || SCOPES.join(' '),
  }
}

export async function refreshCalendarToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`calendar token refresh failed: ${res.status}`)
  const data = await res.json()
  return { accessToken: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 }
}

export async function listCalendars(accessToken: string): Promise<{ id: string; summary: string; primary: boolean }[]> {
  const res = await fetch(`${CAL_API}/users/me/calendarList?minAccessRole=writer`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`calendar list failed: ${res.status}`)
  const data = await res.json()
  return (data.items || []).map((c: { id: string; summary: string; primary?: boolean }) => ({ id: c.id, summary: c.summary, primary: !!c.primary }))
}

export interface CalendarEventInput {
  summary: string
  description?: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
}

export async function createCalendarEvent(accessToken: string, calendarId: string, event: CalendarEventInput): Promise<{ id: string }> {
  const res = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  if (!res.ok) throw new Error(`calendar event create failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return { id: String(data.id) }
}
