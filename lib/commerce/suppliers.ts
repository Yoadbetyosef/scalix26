import { createClient } from '@/lib/supabase/server'
import { requireCommerceAccess } from './guard'

export async function listSuppliers() {
  const c = await requireCommerceAccess(); if (!c) return []
  const sb = await createClient()
  const { data } = await sb.from('commerce_suppliers').select('id, company_name, factory_name, email, phone, default_currency, default_lead_time_days, is_active').eq('tenant_id', c.tenantId).order('company_name')
  return data ?? []
}

export async function createSupplier(input: { companyName: string; factoryName?: string | null; email?: string | null; phone?: string | null; paymentTerms?: string | null; leadTimeDays?: number | null }) {
  const c = await requireCommerceAccess(); if (!c) return { ok: false as const, error: 'unauthorized' }
  const sb = await createClient()
  const { data, error } = await sb.from('commerce_suppliers').insert({
    tenant_id: c.tenantId, company_name: input.companyName.trim(), factory_name: input.factoryName ?? null,
    email: input.email ?? null, phone: input.phone ?? null, payment_terms: input.paymentTerms ?? null, default_lead_time_days: input.leadTimeDays ?? null, created_by: c.actor,
  }).select('id, company_name').single()
  if (error) return { ok: false as const, error: error.message }
  return { ok: true as const, supplier: data }
}
