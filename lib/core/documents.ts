import { createAdminClient } from '@/lib/supabase/server'
import { lineTotalCents, documentTotals, type LineAmounts } from './money'

// Sales-document repository (estimates/quotes/invoices). Totals are recomputed server-side from lines on
// every mutation (client never sets totals). Status changes are recorded in document_status_history.
const admin = () => createAdminClient()
export type DocType = 'estimate' | 'quote' | 'invoice'
const TABLE: Record<DocType, string> = { estimate: 'estimates', quote: 'quotes', invoice: 'invoices' }

export interface DocumentInput { contactId?: string | null; companyId?: string | null; currency?: string; notes?: string | null }
export async function createDocument(tenantId: string, type: DocType, input: DocumentInput, actor: string): Promise<{ ok: true; document: Record<string, unknown> } | { ok: false; error: string }> {
  const { data: num, error: nerr } = await admin().rpc('core_next_document_number', { p_tenant: tenantId, p_doc_type: type })
  if (nerr) return { ok: false, error: nerr.message }
  const { data, error } = await admin().from(TABLE[type]).insert({
    tenant_id: tenantId, number: num as string, contact_id: input.contactId ?? null, company_id: input.companyId ?? null,
    currency: input.currency ?? 'usd', notes: input.notes ?? null, created_by: actor,
  }).select('*').single()
  return error ? { ok: false, error: error.message } : { ok: true, document: data as Record<string, unknown> }
}

export interface LineInput extends LineAmounts { productId?: string | null; variantId?: string | null; description?: string | null; customAttributes?: Record<string, unknown> }
export async function addLine(tenantId: string, type: DocType, documentId: string, line: LineInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const { count } = await admin().from('sales_document_lines').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('document_type', type).eq('document_id', documentId)
  const { error } = await admin().from('sales_document_lines').insert({
    tenant_id: tenantId, document_type: type, document_id: documentId, product_id: line.productId ?? null, variant_id: line.variantId ?? null,
    description: line.description ?? null, quantity: line.quantity, unit_price_cents: line.unit_price_cents,
    discount_cents: line.discount_cents ?? 0, tax_cents: line.tax_cents ?? 0, line_total_cents: lineTotalCents(line),
    custom_attributes: line.customAttributes ?? {}, sort_order: count ?? 0,
  })
  if (error) return { ok: false, error: error.message }
  await recomputeTotals(tenantId, type, documentId)
  return { ok: true }
}

async function recomputeTotals(tenantId: string, type: DocType, documentId: string) {
  const { data } = await admin().from('sales_document_lines').select('quantity, unit_price_cents, discount_cents, tax_cents').eq('tenant_id', tenantId).eq('document_type', type).eq('document_id', documentId)
  const totals = documentTotals((data ?? []) as LineAmounts[])
  await admin().from(TABLE[type]).update({ ...totals, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', documentId)
}

export async function listDocuments(tenantId: string, type: DocType, limit = 200) {
  const { data } = await admin().from(TABLE[type])
    .select('id, number, status, contact_id, company_id, currency, total_cents, source_document_type, created_at, updated_at')
    .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(limit)
  return data ?? []
}

export async function getDocument(tenantId: string, type: DocType, documentId: string) {
  const [{ data: doc }, { data: lines }] = await Promise.all([
    admin().from(TABLE[type]).select('*').eq('tenant_id', tenantId).eq('id', documentId).maybeSingle(),
    admin().from('sales_document_lines').select('*').eq('tenant_id', tenantId).eq('document_type', type).eq('document_id', documentId).order('sort_order'),
  ])
  if (!doc) return null
  let contact = null, company = null
  if (doc.contact_id) contact = (await admin().from('contacts').select('id, name, phone, email').eq('tenant_id', tenantId).eq('id', doc.contact_id).maybeSingle()).data ?? null
  if (doc.company_id) company = (await admin().from('companies').select('id, name').eq('tenant_id', tenantId).eq('id', doc.company_id).maybeSingle()).data ?? null
  return { document: doc, lines: lines ?? [], contact, company }
}

// Attach/clear the customer (contact + optional company) on a document. Cross-tenant safe: a contact/company
// from another tenant is rejected. Conversion preserves these (core_convert_document copies contact_id/company_id).
export async function setDocumentCustomer(tenantId: string, type: DocType, documentId: string, input: { contactId?: string | null; companyId?: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.contactId) { const { data } = await admin().from('contacts').select('id').eq('tenant_id', tenantId).eq('id', input.contactId).maybeSingle(); if (!data) return { ok: false, error: 'contact_not_found' } }
  if (input.companyId) { const { data } = await admin().from('companies').select('id').eq('tenant_id', tenantId).eq('id', input.companyId).maybeSingle(); if (!data) return { ok: false, error: 'company_not_found' } }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('contactId' in input) patch.contact_id = input.contactId ?? null
  if ('companyId' in input) patch.company_id = input.companyId ?? null
  const { data, error } = await admin().from(TABLE[type]).update(patch).eq('tenant_id', tenantId).eq('id', documentId).select('id').maybeSingle()
  if (error) return { ok: false, error: error.message }
  return data ? { ok: true } : { ok: false, error: 'not_found' }
}

export async function updateStatus(tenantId: string, type: DocType, documentId: string, toStatus: string, actor: string, note?: string): Promise<boolean> {
  const { data: doc } = await admin().from(TABLE[type]).select('status').eq('tenant_id', tenantId).eq('id', documentId).maybeSingle()
  if (!doc) return false
  await admin().from(TABLE[type]).update({ status: toStatus, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', documentId)
  await admin().from('document_status_history').insert({ tenant_id: tenantId, document_type: type, document_id: documentId, from_status: doc.status, to_status: toStatus, actor, note: note ?? null })
  return true
}
