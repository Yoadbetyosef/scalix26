import { createAdminClient } from '@/lib/supabase/server'
import type { Company } from './types'

// Tenant-scoped company repository. Every query is filtered by tenant_id — callers pass the tenantId
// resolved by requireCoreTenant(); a client-supplied tenant is never trusted.
const admin = () => createAdminClient()

export async function listCompanies(tenantId: string, opts: { includeArchived?: boolean } = {}): Promise<Company[]> {
  let q = admin().from('companies').select('*').eq('tenant_id', tenantId).order('name')
  if (!opts.includeArchived) q = q.is('archived_at', null)
  const { data } = await q
  return (data as Company[]) ?? []
}

export async function getCompany(tenantId: string, id: string): Promise<Company | null> {
  const { data } = await admin().from('companies').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  return (data as Company | null) ?? null
}

export interface CompanyInput { name: string; domain?: string | null; email?: string | null; phone?: string | null; address?: string | null; notes?: string | null }
export async function createCompany(tenantId: string, actor: string, input: CompanyInput): Promise<{ ok: true; company: Company } | { ok: false; error: string }> {
  if (!input.name?.trim()) return { ok: false, error: 'name_required' }
  const { data, error } = await admin().from('companies').insert({
    tenant_id: tenantId, name: input.name.trim(), domain: input.domain ?? null, email: input.email ?? null,
    phone: input.phone ?? null, address: input.address ?? null, notes: input.notes ?? null, created_by: actor,
  }).select('*').single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, company: data as Company }
}

export async function updateCompany(tenantId: string, id: string, patch: Partial<CompanyInput>): Promise<Company | null> {
  const { data } = await admin().from('companies').update({ ...patch, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id).select('*').maybeSingle()
  return (data as Company | null) ?? null
}

export async function archiveCompany(tenantId: string, id: string, archived = true): Promise<boolean> {
  const { error } = await admin().from('companies').update({ archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id)
  return !error
}

// Link a contact to a company (idempotent on the unique (tenant, contact, company) constraint).
export async function linkContactCompany(tenantId: string, contactId: string, companyId: string, opts: { role?: string | null; isPrimary?: boolean } = {}): Promise<boolean> {
  const { error } = await admin().from('contact_companies').upsert(
    { tenant_id: tenantId, contact_id: contactId, company_id: companyId, role: opts.role ?? null, is_primary: !!opts.isPrimary },
    { onConflict: 'tenant_id,contact_id,company_id' },
  )
  if (error) return false
  if (opts.isPrimary) await admin().from('contacts').update({ company_id: companyId, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', contactId)
  return true
}

export async function unlinkContactCompany(tenantId: string, contactId: string, companyId: string): Promise<boolean> {
  const { error } = await admin().from('contact_companies').delete().eq('tenant_id', tenantId).eq('contact_id', contactId).eq('company_id', companyId)
  return !error
}
