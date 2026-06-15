import { createAdminClient } from '@/lib/supabase/server'
import { decrypt, encrypt } from './crypto'
import { getProvider } from './index'
import type { MailAccount, MailProviderName, OAuthTokens } from './types'

export interface AccountRow {
  id: string
  tenant_id: string
  ai_employee_id: string | null
  provider: MailProviderName
  email_address: string
  access_token: string
  refresh_token: string | null
  token_expiry: string | null
  scopes: string | null
  history_id: string | null
  status: string
}

const COLS = 'id, tenant_id, ai_employee_id, provider, email_address, access_token, refresh_token, token_expiry, scopes, history_id, status'

// Insert/replace the connection for an agent (one per agent+provider). Tokens are
// encrypted before they ever touch the DB.
export async function saveAccount(opts: {
  tenantId: string
  aiEmployeeId: string
  provider: MailProviderName
  tokens: OAuthTokens
}): Promise<void> {
  const supabase = createAdminClient() // true service role — bypasses RLS

  // Isolate the encrypt step so a bad APP_ENCRYPTION_KEY is unmistakable in logs.
  let encAccess: string
  let encRefresh: string | null
  try {
    encAccess = encrypt(opts.tokens.accessToken)
    encRefresh = opts.tokens.refreshToken ? encrypt(opts.tokens.refreshToken) : null
    console.log('[mailbox] saveAccount: encrypt OK for', opts.tokens.email)
  } catch (e) {
    console.error('[mailbox] saveAccount: ENCRYPT FAILED (check APP_ENCRYPTION_KEY = 32 bytes base64/hex):', e instanceof Error ? e.message : e)
    throw e
  }

  const { error: delErr } = await supabase.from('connected_email_accounts')
    .delete().eq('ai_employee_id', opts.aiEmployeeId).eq('provider', opts.provider)
  if (delErr) console.error('[mailbox] saveAccount: delete error (continuing):', delErr.message)

  const { error } = await supabase.from('connected_email_accounts').insert({
    tenant_id: opts.tenantId,
    ai_employee_id: opts.aiEmployeeId,
    provider: opts.provider,
    email_address: opts.tokens.email,
    access_token: encAccess,
    refresh_token: encRefresh,
    token_expiry: new Date(opts.tokens.expiresAt).toISOString(),
    scopes: opts.tokens.scopes,
    history_id: opts.tokens.historyId,
    status: 'connected',
  })
  if (error) {
    console.error('[mailbox] saveAccount: INSERT FAILED:', error.message, '| details:', error.details, '| hint:', error.hint, '| code:', error.code)
    throw new Error('connected_email_accounts insert failed: ' + error.message)
  }
  console.log('[mailbox] saveAccount: inserted row for', opts.tokens.email, 'agent', opts.aiEmployeeId)
}

export async function markAccountError(accountId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('connected_email_accounts').update({ status: 'error' }).eq('id', accountId)
}

export async function listConnectedAccounts(): Promise<AccountRow[]> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('connected_email_accounts').select(COLS).eq('status', 'connected')
  return (data || []) as AccountRow[]
}

// Decrypt + (if near expiry) refresh the access token, persisting the new one.
// On refresh failure (revoked/expired) the account is flagged 'error' and null is
// returned so the poll can skip it and continue — never crash the whole run.
export async function getValidAccount(row: AccountRow): Promise<MailAccount | null> {
  const provider = getProvider(row.provider)
  let accessToken: string
  try {
    accessToken = decrypt(row.access_token)
  } catch (err) {
    console.error('[mailbox] decrypt failed for', row.email_address, err)
    await markAccountError(row.id)
    return null
  }

  const expiry = row.token_expiry ? new Date(row.token_expiry).getTime() : 0
  if (Date.now() > expiry - 60_000) {
    if (!row.refresh_token) {
      console.warn('[mailbox] no refresh token for', row.email_address, '— marking error (reconnect needed)')
      await markAccountError(row.id)
      return null
    }
    try {
      const refreshed = await provider.refresh(decrypt(row.refresh_token))
      accessToken = refreshed.accessToken
      const supabase = createAdminClient()
      await supabase.from('connected_email_accounts').update({
        access_token: encrypt(accessToken),
        token_expiry: new Date(refreshed.expiresAt).toISOString(),
        status: 'connected',
      }).eq('id', row.id)
    } catch (err) {
      console.error('[mailbox] token refresh failed for', row.email_address, '— marking error (reconnect needed):', err instanceof Error ? err.message : err)
      await markAccountError(row.id)
      return null
    }
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    aiEmployeeId: row.ai_employee_id,
    provider: row.provider,
    emailAddress: row.email_address,
    accessToken,
    historyId: row.history_id,
  }
}
