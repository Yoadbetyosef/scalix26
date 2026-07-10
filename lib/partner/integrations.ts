import { createAdminClient } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/mailbox/crypto'

// Per-partner infrastructure credentials for the White Label platform. Partners bring their OWN
// Twilio / OpenAI / ElevenLabs / Email accounts — Scalix stores them encrypted and provisions with
// them. Secrets are AES-GCM encrypted at rest and NEVER returned to the client (status/masked only).

export type Provider = 'twilio' | 'openai' | 'elevenlabs' | 'email' | 'meta' | 'google'
export const KEY_PROVIDERS: Provider[] = ['twilio', 'openai', 'elevenlabs', 'email']
export const OAUTH_PROVIDERS: Provider[] = ['meta', 'google'] // Phase 2

export interface IntegrationStatus {
  provider: Provider
  status: 'not_connected' | 'connected' | 'needs_attention'
  meta: Record<string, unknown>       // non-secret hints only
  health: number | null
  last_verified_at: string | null
  configurable: boolean               // false for OAuth providers (Phase 2)
}

const mask = (s?: string) => (s && s.length >= 4 ? `••••${s.slice(-4)}` : s ? '••••' : '')

// Public (non-secret) hints stored alongside the encrypted blob, safe to show the partner.
function publicMeta(provider: Provider, creds: Record<string, string>): Record<string, unknown> {
  switch (provider) {
    case 'twilio': return { account_sid: mask(creds.account_sid), phone_number: creds.phone_number || null, messaging_service: !!creds.messaging_service_sid }
    case 'openai': return { api_key: mask(creds.api_key), model: creds.model || 'gpt-4o' }
    case 'elevenlabs': return { api_key: mask(creds.api_key) }
    case 'email': return { provider: creds.provider || 'resend', from_email: creds.from_email || null, api_key: mask(creds.api_key) }
    default: return {}
  }
}

// Live "test connection" against the partner's own account. Returns connected + health, or throws.
async function verify(provider: Provider, creds: Record<string, string>): Promise<{ ok: boolean; note?: string }> {
  try {
    if (provider === 'twilio') {
      if (!creds.account_sid || !creds.auth_token) return { ok: false, note: 'Missing SID or token' }
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.account_sid}.json`, { headers: { Authorization: 'Basic ' + Buffer.from(`${creds.account_sid}:${creds.auth_token}`).toString('base64') } })
      return { ok: r.ok, note: r.ok ? undefined : `Twilio ${r.status}` }
    }
    if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${creds.api_key}` } })
      return { ok: r.ok, note: r.ok ? undefined : `OpenAI ${r.status}` }
    }
    if (provider === 'elevenlabs') {
      const r = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': creds.api_key } })
      return { ok: r.ok, note: r.ok ? undefined : `ElevenLabs ${r.status}` }
    }
    if (provider === 'email') {
      if ((creds.provider || 'resend') !== 'resend') return { ok: !!creds.api_key } // SMTP: accept as configured
      const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${creds.api_key}` } })
      return { ok: r.ok, note: r.ok ? undefined : `Resend ${r.status}` }
    }
    return { ok: false, note: 'Not verifiable' }
  } catch (e) {
    return { ok: false, note: (e as Error).message?.slice(0, 80) }
  }
}

export async function getIntegrations(partnerId: string): Promise<IntegrationStatus[]> {
  const { data } = await createAdminClient().from('partner_integrations').select('provider, status, meta, health, last_verified_at').eq('partner_id', partnerId)
  const byProvider = new Map((data || []).map((r) => [r.provider as Provider, r]))
  const all: Provider[] = [...KEY_PROVIDERS, ...OAUTH_PROVIDERS]
  return all.map((provider) => {
    const r = byProvider.get(provider)
    return {
      provider,
      status: (r?.status as IntegrationStatus['status']) || 'not_connected',
      meta: (r?.meta as Record<string, unknown>) || {},
      health: r?.health ?? null,
      last_verified_at: r?.last_verified_at ?? null,
      configurable: KEY_PROVIDERS.includes(provider),
    }
  })
}

// Save + verify a provider's credentials. Returns the (non-secret) status.
export async function saveIntegration(partnerId: string, provider: Provider, creds: Record<string, string>): Promise<{ status: string; note?: string }> {
  if (!KEY_PROVIDERS.includes(provider)) throw new Error('Provider not configurable yet')
  const { ok, note } = await verify(provider, creds)
  const status = ok ? 'connected' : 'needs_attention'
  const db = createAdminClient()
  await db.from('partner_integrations').upsert({
    partner_id: partnerId, provider,
    credentials_encrypted: encrypt(JSON.stringify(creds)),
    meta: publicMeta(provider, creds), status, health: ok ? 100 : 50,
    last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'partner_id,provider' })
  return { status, note }
}

// Re-run the health check on stored credentials.
export async function reverifyIntegration(partnerId: string, provider: Provider): Promise<{ status: string; note?: string }> {
  const creds = await getCredentials(partnerId, provider)
  if (!creds) return { status: 'not_connected' }
  const { ok, note } = await verify(provider, creds)
  await createAdminClient().from('partner_integrations').update({
    status: ok ? 'connected' : 'needs_attention', health: ok ? 100 : 50, last_verified_at: new Date().toISOString(),
  }).eq('partner_id', partnerId).eq('provider', provider)
  return { status: ok ? 'connected' : 'needs_attention', note }
}

export async function disconnectIntegration(partnerId: string, provider: Provider): Promise<void> {
  await createAdminClient().from('partner_integrations').delete().eq('partner_id', partnerId).eq('provider', provider)
}

// Server-only: decrypt a provider's credentials for provisioning. Never expose to the client.
export async function getCredentials(partnerId: string, provider: Provider): Promise<Record<string, string> | null> {
  const { data } = await createAdminClient().from('partner_integrations').select('credentials_encrypted').eq('partner_id', partnerId).eq('provider', provider).maybeSingle()
  if (!data?.credentials_encrypted) return null
  try { return JSON.parse(decrypt(data.credentials_encrypted)) } catch { return null }
}

// Convenience for Twilio-backed provisioning.
export async function getPartnerTwilio(partnerId: string): Promise<{ accountSid: string; authToken: string; messagingServiceSid?: string; phoneNumber?: string } | null> {
  const c = await getCredentials(partnerId, 'twilio')
  if (!c?.account_sid || !c?.auth_token) return null
  return { accountSid: c.account_sid, authToken: c.auth_token, messagingServiceSid: c.messaging_service_sid, phoneNumber: c.phone_number }
}
