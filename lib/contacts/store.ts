import { createClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'

// Contact book writes: manual creation, bulk import, and the type-ahead that backs the order form's
// customer picker. Read paths elsewhere query contacts directly; everything here is tenant-scoped through
// the RLS client and a server-validated tenantId.

export interface ContactSummary {
  id: string; name: string | null; email: string | null; phone: string | null
  address: string | null; currency: string | null
}
export interface ContactInput {
  name?: string | null; email?: string | null; phone?: string | null
  address?: string | null; currency?: string | null; notes?: string | null
}

// Match keys for duplicate detection. Phone comparison ignores formatting; a 10-digit North American
// number and its +1 form are the same person, so we compare the last 10 digits.
export const normalizeEmail = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim().toLowerCase()
  return t.includes('@') ? t : null
}
export const normalizePhone = (v: string | null | undefined): string | null => {
  const digits = (v ?? '').replace(/\D/g, '')
  if (digits.length < 7) return null
  return digits.length > 10 ? digits.slice(-10) : digits
}

const summary = (r: Record<string, unknown>): ContactSummary => ({
  id: r.id as string, name: (r.name as string) ?? null, email: (r.email as string) ?? null,
  phone: (r.phone as string) ?? null, address: (r.address as string) ?? null, currency: (r.currency as string) ?? null,
})

// Type-ahead for the order form. Matches name, email or phone; archived and merged-away contacts are
// excluded so the picker never offers a record that shouldn't be reused.
export async function searchContacts(q: string, limit = 8): Promise<ContactSummary[]> {
  const c = await requireActiveBusinessContext(); if (!c) return []
  const term = q.trim()
  if (term.length < 1) return []
  const sb = await createClient()
  // Escape PostgREST's pattern wildcards and the comma that separates .or() branches.
  const safe = term.replace(/[%,()\\]/g, ' ').trim()
  if (!safe) return []
  const { data } = await sb.from('contacts')
    .select('id, name, email, phone, address, currency')
    .eq('tenant_id', c.tenantId)
    .is('archived_at', null).is('merged_into_id', null)
    .or(`name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`)
    .order('last_interaction', { ascending: false, nullsFirst: false })
    .limit(limit)
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(summary)
}

// Every live contact for the tenant, used to detect duplicates before an import writes anything.
async function loadExisting(tenantId: string): Promise<ContactSummary[]> {
  const sb = await createClient()
  const { data } = await sb.from('contacts')
    .select('id, name, email, phone, address, currency')
    .eq('tenant_id', tenantId).is('merged_into_id', null).limit(10000)
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(summary)
}

const buildIndex = (rows: ContactSummary[]) => {
  const byEmail = new Map<string, ContactSummary>(); const byPhone = new Map<string, ContactSummary>()
  for (const r of rows) {
    const e = normalizeEmail(r.email); if (e && !byEmail.has(e)) byEmail.set(e, r)
    const p = normalizePhone(r.phone); if (p && !byPhone.has(p)) byPhone.set(p, r)
  }
  return { byEmail, byPhone }
}

export async function createContact(input: ContactInput): Promise<{ ok: boolean; error?: string; contact?: ContactSummary; duplicateOf?: ContactSummary }> {
  const c = await requireActiveBusinessContext(); if (!c) return { ok: false, error: 'unauthorized' }
  const name = (input.name ?? '').trim()
  const email = (input.email ?? '').trim()
  const phone = (input.phone ?? '').trim()
  if (!name && !email && !phone) return { ok: false, error: 'Enter at least a name, email, or phone number.' }

  // Refuse to create a second record for someone already in the book — that's the duplicate problem
  // this whole feature exists to solve. The caller shows the existing contact instead.
  const { byEmail, byPhone } = buildIndex(await loadExisting(c.tenantId))
  const e = normalizeEmail(email); const p = normalizePhone(phone)
  const dupe = (e && byEmail.get(e)) || (p && byPhone.get(p)) || null
  if (dupe) return { ok: false, error: 'This person is already in your contacts.', duplicateOf: dupe }

  const sb = await createClient()
  const { data, error } = await sb.from('contacts').insert({
    tenant_id: c.tenantId, name: name || null, email: email || null, phone: phone || null,
    address: (input.address ?? '').trim() || null, currency: (input.currency ?? '').trim() || null,
    notes: (input.notes ?? '').trim() || null,
    normalized_email: e, normalized_phone: p,
    total_conversations: 0,
  }).select('id, name, email, phone, address, currency').single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, contact: summary(data as Record<string, unknown>) }
}

// ── Bulk import ─────────────────────────────────────────────────────────────────────────────────────

export interface ImportRow { name?: string; email?: string; phone?: string; address?: string; currency?: string; notes?: string }
export interface ImportPreview {
  toCreate: ImportRow[]
  duplicates: Array<{ row: ImportRow; existing: ContactSummary; reason: 'email' | 'phone' }>
  skipped: Array<{ row: ImportRow; reason: string }>
}

// Classify parsed rows without writing anything, so the UI can show exactly what will happen first.
// Rows that duplicate each other WITHIN the file collapse to one, matching the dedupe rule for the DB.
export async function previewImport(rows: ImportRow[]): Promise<ImportPreview | null> {
  const c = await requireActiveBusinessContext(); if (!c) return null
  const { byEmail, byPhone } = buildIndex(await loadExisting(c.tenantId))
  const seenEmail = new Set<string>(); const seenPhone = new Set<string>()
  const out: ImportPreview = { toCreate: [], duplicates: [], skipped: [] }

  for (const row of rows) {
    const name = (row.name ?? '').trim()
    const e = normalizeEmail(row.email); const p = normalizePhone(row.phone)
    if (!name && !e && !p) { out.skipped.push({ row, reason: 'No name, email, or phone' }); continue }
    if (e && byEmail.has(e)) { out.duplicates.push({ row, existing: byEmail.get(e)!, reason: 'email' }); continue }
    if (p && byPhone.has(p)) { out.duplicates.push({ row, existing: byPhone.get(p)!, reason: 'phone' }); continue }
    if ((e && seenEmail.has(e)) || (p && seenPhone.has(p))) { out.skipped.push({ row, reason: 'Repeated earlier in this file' }); continue }
    if (e) seenEmail.add(e); if (p) seenPhone.add(p)
    out.toCreate.push(row)
  }
  return out
}

// Insert the rows the preview cleared. Duplicates are never written — the preview already excluded them.
export async function commitImport(rows: ImportRow[]): Promise<{ ok: boolean; created: number; error?: string }> {
  const c = await requireActiveBusinessContext(); if (!c) return { ok: false, created: 0, error: 'unauthorized' }
  const preview = await previewImport(rows)
  if (!preview) return { ok: false, created: 0, error: 'unauthorized' }
  if (!preview.toCreate.length) return { ok: true, created: 0 }

  const sb = await createClient()
  const payload = preview.toCreate.map((r) => ({
    tenant_id: c.tenantId,
    name: (r.name ?? '').trim() || null, email: (r.email ?? '').trim() || null, phone: (r.phone ?? '').trim() || null,
    address: (r.address ?? '').trim() || null, currency: (r.currency ?? '').trim() || null, notes: (r.notes ?? '').trim() || null,
    normalized_email: normalizeEmail(r.email), normalized_phone: normalizePhone(r.phone),
    total_conversations: 0,
  }))
  // Chunked so a large address book doesn't hit the request size limit.
  let created = 0
  for (let i = 0; i < payload.length; i += 500) {
    const { error, data } = await sb.from('contacts').insert(payload.slice(i, i + 500)).select('id')
    if (error) return { ok: false, created, error: error.message }
    created += (data as unknown[] | null)?.length ?? 0
  }
  return { ok: true, created }
}
