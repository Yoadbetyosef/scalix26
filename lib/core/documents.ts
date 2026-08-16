import { createAdminClient } from '@/lib/supabase/server'
import { lineTotalCents, documentTotals, type LineAmounts } from './money'
import { readInvoiceSettings } from './invoice-settings'

// Sales-document repository (estimates/quotes/invoices). Totals are recomputed server-side from lines on
// every mutation (client never sets totals). Status changes are recorded in document_status_history.
const admin = () => createAdminClient()
// 'proposal' is the unified sales document (replaces estimate+quote in the UI). estimate/quote remain valid
// types so legacy records stay fully readable/convertible through the same repo — one document layer.
export type DocType = 'estimate' | 'quote' | 'invoice' | 'proposal'
const TABLE: Record<DocType, string> = { estimate: 'estimates', quote: 'quotes', invoice: 'invoices', proposal: 'proposals' }

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

export interface LineInput extends LineAmounts { productId?: string | null; variantId?: string | null; componentId?: string | null; description?: string | null; customAttributes?: Record<string, unknown> }
export async function addLine(tenantId: string, type: DocType, documentId: string, line: LineInput): Promise<{ ok: true } | { ok: false; error: string }> {
  // AN ISSUED DOCUMENT IS FROZEN. Its total was a promise made to somebody on a date, and a total
  // that can still move is not a promise. The database enforces this too (a trigger on
  // sales_document_lines — see add_document_freeze.sql); this is here so the caller gets a shaped
  // answer instead of a raised exception, and so the rule is visible where lines are written.
  const { data: head } = await admin().from(TABLE[type]).select('status').eq('tenant_id', tenantId).eq('id', documentId).maybeSingle()
  if (!head) return { ok: false, error: 'not_found' }
  if (head.status !== 'draft') return { ok: false, error: 'document_not_draft' }
  const { count } = await admin().from('sales_document_lines').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('document_type', type).eq('document_id', documentId)
  const { error } = await admin().from('sales_document_lines').insert({
    tenant_id: tenantId, document_type: type, document_id: documentId, product_id: line.productId ?? null, variant_id: line.variantId ?? null, component_id: line.componentId ?? null,
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

// ── ISSUING ─────────────────────────────────────────────────────────────────────────────────────
//
// Draft → issued, with a date, and the total frozen from that moment.
//
// THE NUMBER IS NOT ALLOCATED HERE. `createDocument` already takes it from numbering_counters when
// the draft is made, atomically, and the four live invoices carry theirs. Re-allocating at issue would
// renumber them and break every reference anyone already has. What issuing adds is the DATE and the
// FREEZE — see OUTSTANDING §33 for the gap that allocating-at-creation produces, which is a real
// accounting question and a separate decision.
export type IssueResult =
  | { ok: true; number: string; issuedAt: string; totalCents: number }
  | { ok: false; error: 'not_found' | 'already_issued' | 'no_lines' | 'no_number' | string }

export async function issueDocument(tenantId: string, type: DocType, documentId: string, actor: string): Promise<IssueResult> {
  const { data: doc } = await admin().from(TABLE[type])
    .select('id, number, status, total_cents, issued_at').eq('tenant_id', tenantId).eq('id', documentId).maybeSingle()
  if (!doc) return { ok: false, error: 'not_found' }
  // Not an error worth failing a screen over — the caller asked for a state the document is already
  // in, and the honest answer is the document.
  if (doc.status !== 'draft') return { ok: false, error: 'already_issued' }
  if (!doc.number) return { ok: false, error: 'no_number' }

  // An invoice with no lines is not an invoice. A ZERO total is allowed — a fully discounted or
  // goodwill document is a real thing, and refusing it would be this file having an opinion about
  // somebody else's business.
  const { count } = await admin().from('sales_document_lines')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('document_type', type).eq('document_id', documentId)
  if (!count) return { ok: false, error: 'no_lines' }

  const issuedAt = new Date().toISOString()

  // ── WHAT ISSUING FIXES, BESIDES THE TOTAL ────────────────────────────────────────────────────
  //
  // The due date and the payment details are SNAPSHOTTED here, not read at render. Changing your
  // bank details next month must not rewrite an invoice somebody already has — an issued document is
  // a record of what was said, and that includes where the money was meant to go.
  //
  // Invoices only. An estimate has nothing to pay yet and a quote is not owed.
  const stamp: Record<string, unknown> = { status: 'issued', issued_at: issuedAt, updated_at: issuedAt }
  if (type === 'invoice') {
    const settings = await readInvoiceSettings(tenantId)
    stamp.payment_instructions = settings.paymentInstructions
    // A calendar date, computed from the issue date in UTC — `due_on` is a DATE column and a
    // timestamp would drift by timezone for no benefit.
    const due = new Date(issuedAt)
    due.setUTCDate(due.getUTCDate() + settings.netDays)
    stamp.due_on = due.toISOString().slice(0, 10)
  }
  // Guarded on status again in the WHERE clause: two people pressing Issue at once must produce one
  // issued document and one 'already_issued', not two rows of history claiming the same transition.
  const { data: updated, error } = await admin().from(TABLE[type])
    .update(stamp)
    .eq('tenant_id', tenantId).eq('id', documentId).eq('status', 'draft')
    .select('number, total_cents, issued_at').maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!updated) return { ok: false, error: 'already_issued' }

  await admin().from('document_status_history').insert({
    tenant_id: tenantId, document_type: type, document_id: documentId,
    from_status: 'draft', to_status: 'issued', actor, note: null,
  })
  return { ok: true, number: updated.number as string, issuedAt: updated.issued_at as string, totalCents: Number(updated.total_cents ?? 0) }
}

export async function updateStatus(tenantId: string, type: DocType, documentId: string, toStatus: string, actor: string, note?: string): Promise<boolean> {
  // ONE DOOR FOR ISSUING. This function moves a status and writes history; it does not stamp a date
  // or check that there is anything to issue. Letting it write 'issued' would produce a document that
  // says issued with no issued_at and possibly no lines — which is the exact state issueDocument
  // exists to prevent.
  if (toStatus === 'issued') return false
  const { data: doc } = await admin().from(TABLE[type]).select('status').eq('tenant_id', tenantId).eq('id', documentId).maybeSingle()
  if (!doc) return false
  await admin().from(TABLE[type]).update({ status: toStatus, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', documentId)
  await admin().from('document_status_history').insert({ tenant_id: tenantId, document_type: type, document_id: documentId, from_status: doc.status, to_status: toStatus, actor, note: note ?? null })
  return true
}
