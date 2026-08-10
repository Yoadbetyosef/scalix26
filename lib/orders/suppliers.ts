import { createClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'

// Factories and workshops as records rather than as three free-text columns retyped per order.
//
// The list is built by using it: the first work order sent to a factory creates their record, and every
// later order picks the existing one. Nothing was backfilled — see add_orders_7_suppliers.sql for why.

export interface Supplier {
  id: string; name: string; contactName: string | null; email: string | null; phone: string | null
  notes: string | null; createdAt: string
}

const row = (r: Record<string, unknown>): Supplier => ({
  id: r.id as string, name: r.name as string, contactName: (r.contact_name as string) ?? null,
  email: (r.email as string) ?? null, phone: (r.phone as string) ?? null,
  notes: (r.notes as string) ?? null, createdAt: r.created_at as string,
})

export async function listSuppliers(term?: string): Promise<Supplier[]> {
  const c = await requireActiveBusinessContext(); if (!c) return []
  const sb = await createClient()
  let q = sb.from('suppliers').select('*').eq('tenant_id', c.tenantId).is('archived_at', null)
  const t = term?.trim()
  // Name OR contact OR address: she may remember the workshop, the person there, or neither.
  if (t) q = q.or(`name.ilike.%${t}%,contact_name.ilike.%${t}%,email.ilike.%${t}%`)
  const { data } = await q.order('name').limit(20)
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(row)
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  const c = await requireActiveBusinessContext(); if (!c) return null
  const sb = await createClient()
  const { data } = await sb.from('suppliers').select('*').eq('tenant_id', c.tenantId).eq('id', id).maybeSingle()
  return data ? row(data as Record<string, unknown>) : null
}

export interface SupplierInput { name: string; contactName?: string | null; email?: string | null; phone?: string | null; notes?: string | null }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Create, or return the one that already holds this address.
//
// The unique index on (tenant_id, lower(email)) is the real guarantee; this read-first path exists so the
// normal case returns the existing supplier instead of surfacing a constraint violation as an error. The
// insert still races against a concurrent create, so a conflict falls back to re-reading rather than
// failing — the caller wanted "the supplier at this address" either way.
export async function findOrCreateSupplier(input: SupplierInput): Promise<{ supplier?: Supplier; error?: string }> {
  const c = await requireActiveBusinessContext(); if (!c) return { error: 'unauthorized' }
  const name = input.name?.trim()
  const email = input.email?.trim() || null
  if (!name) return { error: 'A supplier name is required.' }
  if (email && !EMAIL_RE.test(email)) return { error: 'That supplier email is not a valid address.' }

  const sb = await createClient()
  if (email) {
    const { data: existing } = await sb.from('suppliers').select('*')
      .eq('tenant_id', c.tenantId).is('archived_at', null).ilike('email', email).maybeSingle()
    if (existing) return { supplier: row(existing as Record<string, unknown>) }
  }

  const { data, error } = await sb.from('suppliers').insert({
    tenant_id: c.tenantId, name, contact_name: input.contactName?.trim() || null, email,
    phone: input.phone?.trim() || null, notes: input.notes?.trim() || null, created_by: c.actorUserId,
  }).select('*').single()

  if (error) {
    if (email) {
      const { data: raced } = await sb.from('suppliers').select('*')
        .eq('tenant_id', c.tenantId).is('archived_at', null).ilike('email', email).maybeSingle()
      if (raced) return { supplier: row(raced as Record<string, unknown>) }
    }
    return { error: error.message }
  }
  return { supplier: row(data as Record<string, unknown>) }
}

/** Resolve the supplier a send is addressed to: an existing id, or details to create one from. */
export async function resolveSupplier(
  supplierId: string | null | undefined,
  fallback: SupplierInput | null,
): Promise<{ supplier?: Supplier; error?: string }> {
  if (supplierId) {
    const s = await getSupplier(supplierId)
    return s ? { supplier: s } : { error: 'That supplier no longer exists.' }
  }
  if (fallback?.name?.trim()) return findOrCreateSupplier(fallback)
  return { error: 'Choose a supplier to send this to.' }
}
