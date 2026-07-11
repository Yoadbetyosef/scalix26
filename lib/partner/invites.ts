import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'

// Client-invitation data layer. Server-only (admin client). One Scalix product — this table just
// controls WHO gets into a given business tenant, under which brand. Statuses:
//   draft → created, not yet sent   |  sent → email dispatched  |  pending → recipient opened the link
//   accepted → password created + linked to the tenant  |  expired (derived)  |  revoked
export type InviteStatus = 'draft' | 'sent' | 'pending' | 'accepted' | 'expired' | 'revoked'

export interface BusinessInvite {
  id: string
  tenant_id: string
  partner_id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  role: string
  status: InviteStatus
  invited_at: string | null
  opened_at: string | null
  accepted_at: string | null
  expires_at: string
  created_at: string
}

const COLS = 'id, tenant_id, partner_id, email, first_name, last_name, phone, role, status, invited_at, opened_at, accepted_at, expires_at, created_at'

export const newInviteToken = () => randomBytes(32).toString('base64url')

// Derive the effective status (expired is time-based, never stored stale).
export function effectiveStatus(inv: { status: string; expires_at: string; accepted_at: string | null }): InviteStatus {
  if (inv.status === 'accepted') return 'accepted'
  if (inv.status === 'revoked') return 'revoked'
  if (!inv.accepted_at && new Date(inv.expires_at).getTime() < Date.now()) return 'expired'
  return inv.status as InviteStatus
}

// The single invite for a business (one owner per business in the single-owner model).
export async function getInviteForTenant(tenantId: string): Promise<BusinessInvite | null> {
  const { data } = await createAdminClient().from('business_invites').select(COLS)
    .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) return null
  return { ...(data as BusinessInvite), status: effectiveStatus(data as BusinessInvite) }
}

// Resolve a live invite by token for the accept flow. Returns the invite + its brand context.
export async function getInviteByToken(token: string) {
  const db = createAdminClient()
  const { data: inv } = await db.from('business_invites').select(COLS).eq('token', token).maybeSingle()
  if (!inv) return null
  const status = effectiveStatus(inv as BusinessInvite)
  const { data: tenant } = await db.from('tenants').select('id, business_name, white_label_partner_id').eq('id', inv.tenant_id).maybeSingle()
  return { invite: { ...(inv as BusinessInvite), status }, tenant }
}

// Upsert the owner invite for a business (create or update the recipient details). Keeps one row per
// (email, tenant) via the unique index; regenerates the token on (re)send.
export async function upsertInvite(input: {
  tenantId: string; partnerId: string; email: string; firstName?: string | null; lastName?: string | null; phone?: string | null; role?: string
}): Promise<BusinessInvite> {
  const db = createAdminClient()
  const email = input.email.trim().toLowerCase()
  const existing = await db.from('business_invites').select('id').eq('tenant_id', input.tenantId).eq('email', email).maybeSingle()
  const row = {
    tenant_id: input.tenantId, partner_id: input.partnerId, email,
    first_name: input.firstName ?? null, last_name: input.lastName ?? null, phone: input.phone ?? null,
    role: input.role || 'business_owner', updated_at: new Date().toISOString(),
  }
  if (existing.data?.id) {
    const { data } = await db.from('business_invites').update(row).eq('id', existing.data.id).select(COLS).single()
    return data as BusinessInvite
  }
  const { data } = await db.from('business_invites')
    .insert({ ...row, token: newInviteToken(), status: 'draft' }).select(COLS).single()
  return data as BusinessInvite
}
