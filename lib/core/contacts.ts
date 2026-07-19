import { createAdminClient } from '@/lib/supabase/server'
import { normalizePhone, normalizeEmail } from './normalize'
import { findDuplicates, type DedupeCandidate, type DuplicateMatch } from './dedupe'
import { addActivity } from './activities'

// Tenant-scoped contact operations that Phase 2 adds on top of the existing (auto-populated) contacts
// table: archive-without-delete, normalized-key maintenance, and duplicate detection.
const admin = () => createAdminClient()

const CONTACT_COLS = 'id, name, phone, email, channel, address, language, notes, total_conversations, last_interaction, archived_at, merged_into_id, created_at, updated_at'

// Active contacts for a tenant (excludes merged-away rows). Optionally include archived.
export async function listContacts(tenantId: string, opts: { includeArchived?: boolean } = {}): Promise<Record<string, unknown>[]> {
  let q = admin().from('contacts').select(CONTACT_COLS).eq('tenant_id', tenantId).is('merged_into_id', null)
  if (!opts.includeArchived) q = q.is('archived_at', null)
  const { data } = await q.order('last_interaction', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(500)
  return (data as Record<string, unknown>[]) ?? []
}

export async function getContact(tenantId: string, id: string): Promise<Record<string, unknown> | null> {
  const { data } = await admin().from('contacts').select(CONTACT_COLS).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  return (data as Record<string, unknown> | null) ?? null
}

export async function archiveContact(tenantId: string, id: string, actor: string, archived = true): Promise<boolean> {
  const { error } = await admin().from('contacts').update({ archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id)
  if (error) return false
  await addActivity(tenantId, { contactId: id, type: 'archive', title: archived ? 'Contact archived' : 'Contact restored', actor })
  return true
}

// Keep normalized dedupe keys in sync when name/phone/email change.
export async function updateContactCore(tenantId: string, id: string, patch: { name?: string; phone?: string | null; email?: string | null; owner_user_id?: string | null; company_id?: string | null }): Promise<boolean> {
  const next: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() }
  if ('phone' in patch) next.normalized_phone = normalizePhone(patch.phone)
  if ('email' in patch) next.normalized_email = normalizeEmail(patch.email)
  const { error } = await admin().from('contacts').update(next).eq('tenant_id', tenantId).eq('id', id)
  return !error
}

// Populate normalized_phone/email for a tenant's contacts (idempotent backfill; deterministic keys).
export async function backfillNormalizedKeys(tenantId: string): Promise<number> {
  const { data } = await admin().from('contacts').select('id, phone, email').eq('tenant_id', tenantId)
  let n = 0
  for (const c of (data ?? []) as Array<{ id: string; phone: string | null; email: string | null }>) {
    await admin().from('contacts').update({ normalized_phone: normalizePhone(c.phone), normalized_email: normalizeEmail(c.email) }).eq('tenant_id', tenantId).eq('id', c.id)
    n++
  }
  return n
}

// Suggest likely duplicates of a contact (exact normalized phone/email overlap, scored). Excludes archived
// and already-merged rows.
export async function findContactDuplicates(tenantId: string, contactId: string): Promise<DuplicateMatch[]> {
  const { data: self } = await admin().from('contacts').select('id, name, normalized_phone, normalized_email').eq('tenant_id', tenantId).eq('id', contactId).maybeSingle()
  if (!self) return []
  const c = self as DedupeCandidate
  const ors: string[] = []
  if (c.normalized_phone) ors.push(`normalized_phone.eq.${c.normalized_phone}`)
  if (c.normalized_email) ors.push(`normalized_email.eq.${c.normalized_email}`)
  if (!ors.length) return []
  const { data: others } = await admin().from('contacts')
    .select('id, name, normalized_phone, normalized_email')
    .eq('tenant_id', tenantId).is('archived_at', null).is('merged_into_id', null).neq('id', contactId)
    .or(ors.join(','))
  return findDuplicates(c, (others as DedupeCandidate[]) ?? [])
}
