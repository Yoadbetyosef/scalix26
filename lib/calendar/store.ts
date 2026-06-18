import { createAdminClient } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/mailbox/crypto'
import { refreshCalendarToken, type CalendarTokens } from './google'

// Per-tenant Google Calendar connection store. Tokens are encrypted at rest
// (reuses lib/mailbox/crypto). All writes use the admin client (server-only).

const COLS = 'id, tenant_id, email_address, access_token, refresh_token, token_expiry, scopes, calendar_id, calendar_summary, status'

export async function saveCalendar(opts: { tenantId: string; tokens: CalendarTokens; calendarId?: string; calendarSummary?: string | null }): Promise<void> {
  const supabase = createAdminClient()
  const encAccess = encrypt(opts.tokens.accessToken)
  const encRefresh = opts.tokens.refreshToken ? encrypt(opts.tokens.refreshToken) : null
  // One calendar connection per tenant — replace any existing.
  await supabase.from('connected_calendars').delete().eq('tenant_id', opts.tenantId)
  const { error } = await supabase.from('connected_calendars').insert({
    tenant_id: opts.tenantId,
    email_address: opts.tokens.email || null,
    access_token: encAccess,
    refresh_token: encRefresh,
    token_expiry: new Date(opts.tokens.expiresAt).toISOString(),
    scopes: opts.tokens.scopes,
    calendar_id: opts.calendarId || 'primary',
    calendar_summary: opts.calendarSummary || null,
    status: 'connected',
  })
  if (error) throw new Error('connected_calendars insert failed: ' + error.message)
}

export async function getCalendarStatus(tenantId: string): Promise<{ connected: boolean; email?: string | null; calendarId?: string; calendarSummary?: string | null }> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('connected_calendars').select('email_address, calendar_id, calendar_summary, status').eq('tenant_id', tenantId).maybeSingle()
  if (!data || data.status !== 'connected') return { connected: false }
  return { connected: true, email: data.email_address, calendarId: data.calendar_id, calendarSummary: data.calendar_summary }
}

export async function setCalendarSelection(tenantId: string, calendarId: string, calendarSummary: string | null): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('connected_calendars').update({ calendar_id: calendarId, calendar_summary: calendarSummary }).eq('tenant_id', tenantId)
}

export async function disconnectCalendar(tenantId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('connected_calendars').delete().eq('tenant_id', tenantId)
}

// Returns a valid (refreshed if needed) access token + the selected calendar id,
// or null if not connected / refresh failed. Never throws — callers are fail-safe.
export async function getCalendarAccess(tenantId: string): Promise<{ accessToken: string; calendarId: string } | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('connected_calendars').select(COLS).eq('tenant_id', tenantId).maybeSingle()
  if (!data || data.status !== 'connected') return null

  let accessToken: string
  try { accessToken = decrypt(data.access_token) } catch { return null }

  const expiry = data.token_expiry ? new Date(data.token_expiry).getTime() : 0
  if (Date.now() > expiry - 60_000) {
    if (!data.refresh_token) return null
    try {
      const refreshed = await refreshCalendarToken(decrypt(data.refresh_token))
      accessToken = refreshed.accessToken
      await supabase.from('connected_calendars')
        .update({ access_token: encrypt(accessToken), token_expiry: new Date(refreshed.expiresAt).toISOString() })
        .eq('tenant_id', tenantId)
    } catch (e) {
      console.warn('[calendar] token refresh failed:', e instanceof Error ? e.message : e)
      return null
    }
  }
  return { accessToken, calendarId: data.calendar_id || 'primary' }
}

// Resolve the logged-in user's tenant id (one tenant per user). Used by the
// calendar management routes to scope per-tenant without trusting client input.
export async function resolveOwnerTenantId(userId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('tenants').select('id').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data?.id || null
}
