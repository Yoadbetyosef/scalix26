import { createAdminClient } from '@/lib/supabase/server'
import { normalizeIdentity } from './normalize'
import type { ChannelIdentity, IdentityChannel } from './types'

// Cross-channel contact identity: map (channel, external_id) → contact so the same person on SMS, email
// and social resolves to ONE contact instead of fragmenting. Tenant-scoped, unique per (tenant, channel,
// external_id). This is the substrate that fixes today's "social ids overloaded into contacts.phone".
const admin = () => createAdminClient()

export async function upsertIdentity(tenantId: string, contactId: string, channel: IdentityChannel, rawExternalId: string): Promise<boolean> {
  const external = normalizeIdentity(channel, rawExternalId)
  if (!external) return false
  const { error } = await admin().from('channel_identities').upsert(
    { tenant_id: tenantId, contact_id: contactId, channel, external_id: external },
    { onConflict: 'tenant_id,channel,external_id' },
  )
  return !error
}

export async function resolveContactByIdentity(tenantId: string, channel: IdentityChannel, rawExternalId: string): Promise<string | null> {
  const external = normalizeIdentity(channel, rawExternalId)
  if (!external) return null
  const { data } = await admin().from('channel_identities').select('contact_id').eq('tenant_id', tenantId).eq('channel', channel).eq('external_id', external).maybeSingle()
  return (data?.contact_id as string) ?? null
}

export async function listIdentities(tenantId: string, contactId: string): Promise<ChannelIdentity[]> {
  const { data } = await admin().from('channel_identities').select('*').eq('tenant_id', tenantId).eq('contact_id', contactId)
  return (data as ChannelIdentity[]) ?? []
}
