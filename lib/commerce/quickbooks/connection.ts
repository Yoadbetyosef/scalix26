import { createAdminClient } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/mailbox/crypto'
import { QBO, qboApiBase, type QboEnvironment } from './config'
import { exchangeCode, refreshTokens, revokeToken, type QboTokens } from './oauth'

// Server-only store + client for a tenant's QuickBooks connection. Tokens live encrypted; nothing here
// that returns to the browser ever includes them (see getStatus). All writes go through the admin client
// so RLS never downgrades to the user JWT on a server-only secret table.

const TABLE = 'commerce_quickbooks_connections'
const REFRESH_BUFFER_MS = 2 * 60 * 1000 // refresh a bit before the access token actually expires

interface ConnectionRow {
  tenant_id: string; realm_id: string; environment: QboEnvironment
  access_token_encrypted: string; refresh_token_encrypted: string
  access_token_expires_at: string; refresh_token_expires_at: string | null
  status: 'active' | 'disconnected' | 'error'; company_name: string | null; last_error: string | null
  last_synced_at: string | null; connected_at: string
}

async function getRow(tenantId: string): Promise<ConnectionRow | null> {
  const { data } = await createAdminClient().from(TABLE).select('*').eq('tenant_id', tenantId).maybeSingle()
  return (data as ConnectionRow | null) ?? null
}

// Safe, browser-facing status (never tokens).
export interface QboStatus { connected: boolean; environment: QboEnvironment; realmId?: string; companyName?: string | null; status?: string; connectedAt?: string; lastError?: string | null; lastSyncedAt?: string | null }
export async function getStatus(tenantId: string): Promise<QboStatus> {
  const r = await getRow(tenantId)
  if (!r || r.status === 'disconnected') return { connected: false, environment: QBO.environment }
  return { connected: r.status === 'active', environment: r.environment, realmId: r.realm_id, companyName: r.company_name, status: r.status, connectedAt: r.connected_at, lastError: r.last_error, lastSyncedAt: r.last_synced_at }
}

function persistTokens(tenantId: string, realmId: string, tokens: QboTokens, extra: { by?: string; companyName?: string | null }) {
  const now = Date.now()
  return createAdminClient().from(TABLE).upsert({
    tenant_id: tenantId, realm_id: realmId, environment: QBO.environment,
    access_token_encrypted: encrypt(tokens.accessToken), refresh_token_encrypted: encrypt(tokens.refreshToken),
    access_token_expires_at: new Date(now + tokens.expiresInSec * 1000).toISOString(),
    refresh_token_expires_at: new Date(now + tokens.refreshExpiresInSec * 1000).toISOString(),
    status: 'active', last_error: null,
    ...(extra.companyName !== undefined ? { company_name: extra.companyName } : {}),
    ...(extra.by ? { connected_by: extra.by } : {}),
    updated_at: new Date(now).toISOString(),
  }, { onConflict: 'tenant_id' })
}

// Complete the OAuth handshake and store the connection. Also fetches the company name for display.
export async function completeConnection(tenantId: string, realmId: string, code: string, actor: string): Promise<{ ok: true; companyName: string | null } | { ok: false; error: string }> {
  try {
    const tokens = await exchangeCode(code)
    await persistTokens(tenantId, realmId, tokens, { by: actor })
    const companyName = await fetchCompanyName(QBO.environment, realmId, tokens.accessToken).catch(() => null)
    if (companyName !== null) await createAdminClient().from(TABLE).update({ company_name: companyName, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId)
    return { ok: true, companyName }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

async function markError(tenantId: string, error: string) {
  await createAdminClient().from(TABLE).update({ status: 'error', last_error: error, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId)
}

// Return a valid access token, transparently refreshing (and persisting) if it is near expiry. Null when
// there is no usable connection (caller treats as "not connected").
async function validAccessToken(tenantId: string): Promise<{ token: string; realmId: string; environment: QboEnvironment } | null> {
  const r = await getRow(tenantId)
  if (!r || r.status === 'disconnected') return null
  if (Date.parse(r.access_token_expires_at) - Date.now() > REFRESH_BUFFER_MS) {
    return { token: decrypt(r.access_token_encrypted), realmId: r.realm_id, environment: r.environment }
  }
  try {
    const tokens = await refreshTokens(decrypt(r.refresh_token_encrypted))
    await persistTokens(tenantId, r.realm_id, tokens, {})
    return { token: tokens.accessToken, realmId: r.realm_id, environment: r.environment }
  } catch (e) {
    await markError(tenantId, `refresh_failed: ${(e as Error).message}`)
    return null
  }
}

// Authenticated call against the tenant's QBO company. `path` is realm-relative, e.g. `/companyinfo/123`.
// Retries once on a 401 by forcing a refresh. Throws on non-OK so callers can surface a real error.
export async function qboFetch(tenantId: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const conn = await validAccessToken(tenantId)
  if (!conn) throw new Error('quickbooks_not_connected')
  const url = `${qboApiBase(conn.environment)}/v3/company/${conn.realmId}${path}`
  const headers = { Authorization: `Bearer ${conn.token}`, Accept: 'application/json', ...(init.headers || {}) }
  const res = await fetch(url, { ...init, headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401) await markError(tenantId, 'unauthorized')
    throw new Error(`qbo_api_${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

// CompanyInfo doubles as a health check — a cheap authenticated read that proves the token works.
async function fetchCompanyName(env: QboEnvironment, realmId: string, accessToken: string): Promise<string | null> {
  const res = await fetch(`${qboApiBase(env)}/v3/company/${realmId}/companyinfo/${realmId}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  if (!res.ok) return null
  const json = (await res.json()) as { CompanyInfo?: { CompanyName?: string } }
  return json.CompanyInfo?.CompanyName ?? null
}

// "Test connection" from the settings card — refreshes if needed and reads CompanyInfo through the same
// authenticated path a real sync would use, so a green result means the token genuinely works.
export async function testConnection(tenantId: string): Promise<{ ok: boolean; companyName?: string | null; error?: string }> {
  const conn = await validAccessToken(tenantId)
  if (!conn) return { ok: false, error: 'quickbooks_not_connected' }
  const companyName = await fetchCompanyName(conn.environment, conn.realmId, conn.token).catch(() => null)
  if (companyName === null) return { ok: false, error: 'companyinfo_read_failed' }
  await createAdminClient().from(TABLE).update({ company_name: companyName, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('tenant_id', tenantId)
  return { ok: true, companyName }
}

export async function disconnect(tenantId: string): Promise<void> {
  const r = await getRow(tenantId)
  if (r?.refresh_token_encrypted) { try { await revokeToken(decrypt(r.refresh_token_encrypted)) } catch { /* best-effort */ } }
  await createAdminClient().from(TABLE).delete().eq('tenant_id', tenantId)
}
