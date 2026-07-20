import { createAdminClient } from '@/lib/supabase/server'
import { lineTotalCents, proposalTotals } from './money'
import { convertDocument } from './convert'
import { generateProposalToken, hashToken } from './proposal-token'
import { generateOrderNumber } from '@/lib/orders/order-number'
import { sendEmail } from '@/lib/email/send'
import { proposalEmailHtml } from './proposal-email'
export { PROPOSAL_STATUSES, type ProposalStatus } from './proposal-status'

// Unified Proposals layer. A `proposals` row is the going-forward sales document; legacy `estimates` and
// `quotes` rows stay fully readable through the same list/detail so no history is lost. Only NEW proposals
// are editable/sendable/convertible here — legacy docs are shown read-only, keeping their type internally.
const admin = () => createAdminClient()
const now = () => new Date().toISOString()

export type ProposalLegacyType = 'proposal' | 'estimate' | 'quote'

// ── Reads ────────────────────────────────────────────────────────────────────────────────────────────
// Lazily expire proposals that were presented to a customer (sent/viewed) and are past their expiry.
async function expireStale(tenantId: string) {
  await admin().from('proposals').update({ status: 'expired', expired_at: now() })
    .eq('tenant_id', tenantId).in('status', ['sent', 'viewed']).not('expires_at', 'is', null).lt('expires_at', now())
}

export interface UnifiedRow { id: string; legacy_type: ProposalLegacyType; number: string; status: string; contact_id: string | null; company_id: string | null; currency: string; total_cents: number; expires_at: string | null; created_at: string; updated_at: string }

export async function listProposals(tenantId: string, limit = 300): Promise<UnifiedRow[]> {
  await expireStale(tenantId)
  const cols = 'id, number, status, contact_id, company_id, currency, total_cents, created_at, updated_at'
  const [p, e, q] = await Promise.all([
    admin().from('proposals').select(`${cols}, expires_at`).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(limit),
    admin().from('estimates').select(cols).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(limit),
    admin().from('quotes').select(cols).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(limit),
  ])
  const rows: UnifiedRow[] = [
    ...(p.data ?? []).map((r) => ({ ...(r as Record<string, unknown>), legacy_type: 'proposal' as const })),
    ...(e.data ?? []).map((r) => ({ ...(r as Record<string, unknown>), expires_at: null, legacy_type: 'estimate' as const })),
    ...(q.data ?? []).map((r) => ({ ...(r as Record<string, unknown>), expires_at: null, legacy_type: 'quote' as const })),
  ] as unknown as UnifiedRow[]
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit)
}

// Which table holds this id? UUIDs are globally unique, so a proposal id and a legacy estimate/quote id
// never collide — old /commerce/{estimates,quotes}/[id] links resolve here and render in the same detail.
export async function resolveProposalType(tenantId: string, id: string): Promise<ProposalLegacyType | null> {
  for (const [type, table] of [['proposal', 'proposals'], ['estimate', 'estimates'], ['quote', 'quotes']] as const) {
    const { data } = await admin().from(table).select('id').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
    if (data) return type
  }
  return null
}

const TABLE: Record<ProposalLegacyType, string> = { proposal: 'proposals', estimate: 'estimates', quote: 'quotes' }

export async function getProposal(tenantId: string, id: string) {
  const type = await resolveProposalType(tenantId, id)
  if (!type) return null
  if (type === 'proposal') await expireStale(tenantId)
  const docType = type // sales_document_lines.document_type matches the legacy type
  const [{ data: doc }, { data: lines }] = await Promise.all([
    admin().from(TABLE[type]).select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle(),
    admin().from('sales_document_lines').select('*').eq('tenant_id', tenantId).eq('document_type', docType).eq('document_id', id).order('sort_order'),
  ])
  if (!doc) return null
  let contact = null, company = null
  if (doc.contact_id) contact = (await admin().from('contacts').select('id, name, phone, email').eq('tenant_id', tenantId).eq('id', doc.contact_id).maybeSingle()).data ?? null
  if (doc.company_id) company = (await admin().from('companies').select('id, name').eq('tenant_id', tenantId).eq('id', doc.company_id).maybeSingle()).data ?? null
  const [{ data: history }] = await Promise.all([
    admin().from('document_status_history').select('from_status, to_status, note, created_at').eq('tenant_id', tenantId).eq('document_type', docType).eq('document_id', id).order('created_at', { ascending: false }).limit(50),
  ])
  return { type, editable: type === 'proposal', document: doc, lines: lines ?? [], contact, company, history: history ?? [] }
}

// ── Create / duplicate ───────────────────────────────────────────────────────────────────────────────
export async function createProposal(tenantId: string, actor: string, input: { contactId?: string | null; companyId?: string | null; currency?: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data: num, error: nerr } = await admin().rpc('core_next_document_number', { p_tenant: tenantId, p_doc_type: 'proposal' })
  if (nerr) return { ok: false, error: nerr.message }
  const { data, error } = await admin().from('proposals').insert({
    tenant_id: tenantId, number: num as string, contact_id: input.contactId ?? null, company_id: input.companyId ?? null,
    currency: input.currency ?? 'usd', status: 'draft', salesperson_id: actor, created_by: actor,
  }).select('id').single()
  return error ? { ok: false, error: error.message } : { ok: true, id: data.id as string }
}

export async function duplicateProposal(tenantId: string, actor: string, id: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const src = await getProposal(tenantId, id)
  if (!src) return { ok: false, error: 'not_found' }
  const created = await createProposal(tenantId, actor, { contactId: src.document.contact_id as string | null, companyId: src.document.company_id as string | null, currency: src.document.currency as string })
  if (!created.ok) return created
  // copy editable header fields (never tokens/lifecycle) + all lines
  await admin().from('proposals').update({
    customer_notes: src.document.customer_notes ?? null, internal_notes: src.document.internal_notes ?? null,
    terms: src.document.terms ?? null, expires_at: src.document.expires_at ?? null,
    overall_discount_cents: src.document.overall_discount_cents ?? 0, tax_cents: src.document.tax_cents ?? 0,
    updated_at: now(),
  }).eq('tenant_id', tenantId).eq('id', created.id)
  const srcLines = src.lines as Record<string, unknown>[]
  if (srcLines.length) {
    await admin().from('sales_document_lines').insert(srcLines.map((l) => ({
      tenant_id: tenantId, document_type: 'proposal', document_id: created.id,
      product_id: l.product_id ?? null, variant_id: l.variant_id ?? null, component_id: l.component_id ?? null,
      description: l.description ?? null, quantity: l.quantity, unit_price_cents: l.unit_price_cents,
      discount_cents: l.discount_cents ?? 0, tax_cents: l.tax_cents ?? 0, line_total_cents: l.line_total_cents,
      custom_attributes: l.custom_attributes ?? {}, sort_order: l.sort_order ?? 0,
    })))
  }
  await recomputeTotals(tenantId, created.id)
  return { ok: true, id: created.id }
}

// ── Autosave (proposal-only header fields) ───────────────────────────────────────────────────────────
export interface ProposalPatch { contactId?: string | null; companyId?: string | null; currency?: string; status?: string; salespersonId?: string | null; expiresAt?: string | null; customerNotes?: string | null; internalNotes?: string | null; terms?: string | null; overallDiscountCents?: number; taxCents?: number; notes?: string | null }
const PATCH_MAP: Record<keyof ProposalPatch, string> = { contactId: 'contact_id', companyId: 'company_id', currency: 'currency', status: 'status', salespersonId: 'salesperson_id', expiresAt: 'expires_at', customerNotes: 'customer_notes', internalNotes: 'internal_notes', terms: 'terms', overallDiscountCents: 'overall_discount_cents', taxCents: 'tax_cents', notes: 'notes' }

export async function updateProposal(tenantId: string, id: string, patch: ProposalPatch): Promise<{ ok: true } | { ok: false; error: string }> {
  if ((await resolveProposalType(tenantId, id)) !== 'proposal') return { ok: false, error: 'not_editable' } // legacy docs are read-only
  if (patch.contactId) { const { data } = await admin().from('contacts').select('id').eq('tenant_id', tenantId).eq('id', patch.contactId).maybeSingle(); if (!data) return { ok: false, error: 'contact_not_found' } }
  if (patch.companyId) { const { data } = await admin().from('companies').select('id').eq('tenant_id', tenantId).eq('id', patch.companyId).maybeSingle(); if (!data) return { ok: false, error: 'company_not_found' } }
  const upd: Record<string, unknown> = { updated_at: now() }
  for (const k of Object.keys(patch) as (keyof ProposalPatch)[]) if (patch[k] !== undefined) upd[PATCH_MAP[k]] = patch[k]
  const { error } = await admin().from('proposals').update(upd).eq('tenant_id', tenantId).eq('id', id)
  if (error) return { ok: false, error: error.message }
  if (patch.overallDiscountCents !== undefined || patch.taxCents !== undefined) await recomputeTotals(tenantId, id)
  return { ok: true }
}

// ── Lines (with catalog snapshots) ─────────────────────────────────────────────────────────────────
export interface ProposalLineInput { productId?: string | null; variantId?: string | null; componentId?: string | null; description?: string | null; quantity: number; unit_price_cents: number; discount_cents?: number; customAttributes?: Record<string, unknown> }

async function assertEditable(tenantId: string, id: string) { return (await resolveProposalType(tenantId, id)) === 'proposal' }

export async function addProposalLine(tenantId: string, id: string, line: ProposalLineInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await assertEditable(tenantId, id))) return { ok: false, error: 'not_editable' }
  const { count } = await admin().from('sales_document_lines').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('document_type', 'proposal').eq('document_id', id)
  const { error } = await admin().from('sales_document_lines').insert({
    tenant_id: tenantId, document_type: 'proposal', document_id: id, product_id: line.productId ?? null, variant_id: line.variantId ?? null, component_id: line.componentId ?? null,
    description: line.description ?? null, quantity: line.quantity, unit_price_cents: line.unit_price_cents,
    discount_cents: line.discount_cents ?? 0, tax_cents: 0, line_total_cents: lineTotalCents({ quantity: line.quantity, unit_price_cents: line.unit_price_cents, discount_cents: line.discount_cents ?? 0 }),
    custom_attributes: line.customAttributes ?? {}, sort_order: count ?? 0,
  })
  if (error) return { ok: false, error: error.message }
  await recomputeTotals(tenantId, id)
  return { ok: true }
}

export async function updateProposalLine(tenantId: string, id: string, lineId: string, patch: { description?: string | null; quantity?: number; unit_price_cents?: number; discount_cents?: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await assertEditable(tenantId, id))) return { ok: false, error: 'not_editable' }
  const { data: cur } = await admin().from('sales_document_lines').select('quantity, unit_price_cents, discount_cents').eq('tenant_id', tenantId).eq('document_id', id).eq('id', lineId).maybeSingle()
  if (!cur) return { ok: false, error: 'line_not_found' }
  const merged = { quantity: patch.quantity ?? (cur.quantity as number), unit_price_cents: patch.unit_price_cents ?? (cur.unit_price_cents as number), discount_cents: patch.discount_cents ?? (cur.discount_cents as number) }
  const upd: Record<string, unknown> = { ...merged, line_total_cents: lineTotalCents(merged) }
  if (patch.description !== undefined) upd.description = patch.description
  const { error } = await admin().from('sales_document_lines').update(upd).eq('tenant_id', tenantId).eq('document_id', id).eq('id', lineId)
  if (error) return { ok: false, error: error.message }
  await recomputeTotals(tenantId, id)
  return { ok: true }
}

export async function removeProposalLine(tenantId: string, id: string, lineId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await assertEditable(tenantId, id))) return { ok: false, error: 'not_editable' }
  await admin().from('sales_document_lines').delete().eq('tenant_id', tenantId).eq('document_type', 'proposal').eq('document_id', id).eq('id', lineId)
  await recomputeTotals(tenantId, id)
  return { ok: true }
}

// subtotal = Σ gross; discount = Σ line discounts + overall; total = max(0, subtotal − discount) + document tax.
async function recomputeTotals(tenantId: string, id: string) {
  const [{ data: lines }, { data: hdr }] = await Promise.all([
    admin().from('sales_document_lines').select('quantity, unit_price_cents, discount_cents').eq('tenant_id', tenantId).eq('document_type', 'proposal').eq('document_id', id),
    admin().from('proposals').select('overall_discount_cents, tax_cents').eq('tenant_id', tenantId).eq('id', id).maybeSingle(),
  ])
  const t = proposalTotals((lines ?? []) as { quantity: number; unit_price_cents: number; discount_cents: number }[], (hdr?.overall_discount_cents as number) ?? 0, (hdr?.tax_cents as number) ?? 0)
  await admin().from('proposals').update({ subtotal_cents: t.subtotal_cents, discount_cents: t.discount_cents, total_cents: t.total_cents, updated_at: now() }).eq('tenant_id', tenantId).eq('id', id)
}

// ── Send (branded email + secure token) ───────────────────────────────────────────────────────────────
async function tenantBranding(tenantId: string) {
  const { data } = await admin().from('tenants').select('business_name, email, phone').eq('id', tenantId).maybeSingle()
  return { businessName: (data?.business_name as string) || 'Our team', email: (data?.email as string) ?? null, phone: (data?.phone as string) ?? null }
}
async function lineThumbnails(tenantId: string, id: string): Promise<string[]> {
  const { data: lines } = await admin().from('sales_document_lines').select('product_id, component_id, custom_attributes').eq('tenant_id', tenantId).eq('document_type', 'proposal').eq('document_id', id).order('sort_order').limit(6)
  const urls: string[] = []
  for (const l of (lines ?? []) as { product_id: string | null; component_id: string | null; custom_attributes: Record<string, unknown> | null }[]) {
    const snap = (l.custom_attributes?.image_url as string) || null
    if (snap) { urls.push(snap); continue }
    if (l.component_id) { const { data } = await admin().from('product_components').select('image_url').eq('id', l.component_id).maybeSingle(); if (data?.image_url) urls.push(data.image_url as string) }
  }
  return [...new Set(urls)].slice(0, 4)
}

export async function sendProposal(tenantId: string, actor: string, id: string, input: { recipientEmail: string; baseUrl: string }): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  if (!(await assertEditable(tenantId, id))) return { ok: false, error: 'not_editable' }
  const { data: doc } = await admin().from('proposals').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (!doc) return { ok: false, error: 'not_found' }
  const { token, hash } = generateProposalToken()
  await admin().from('proposals').update({ public_token_hash: hash, public_token_revoked_at: null, sent_at: doc.sent_at ?? now(), status: 'sent', updated_at: now() }).eq('tenant_id', tenantId).eq('id', id)
  await admin().from('document_status_history').insert({ tenant_id: tenantId, document_type: 'proposal', document_id: id, from_status: doc.status, to_status: 'sent', actor, note: `Sent to ${input.recipientEmail}` })

  const brand = await tenantBranding(tenantId)
  const contact = doc.contact_id ? (await admin().from('contacts').select('name').eq('id', doc.contact_id).maybeSingle()).data : null
  const link = `${input.baseUrl.replace(/\/$/, '')}/proposals/${token}` // raw token only in the link
  const fmt = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: (doc.currency as string) || 'usd' }).format(c / 100)
  const html = proposalEmailHtml({
    businessName: brand.businessName, customerName: (contact?.name as string) ?? null, proposalNumber: doc.number as string,
    summary: (doc.customer_notes as string) ?? null, thumbnails: await lineThumbnails(tenantId, id),
    totalFormatted: fmt(doc.total_cents as number), expiresOn: doc.expires_at ? String(doc.expires_at).slice(0, 10) : null,
    link, supportEmail: brand.email,
  })
  const res = await sendEmail(input.recipientEmail, `Your proposal ${doc.number} from ${brand.businessName}`, html, { tenantId, fromName: brand.businessName, replyTo: brand.email ?? undefined }).catch((e) => ({ success: false as const, error: (e as Error).message }))
  if (!res.success) return { ok: false, error: ('error' in res && res.error) || 'send_failed' }
  return { ok: true, link }
}

export async function revokeProposalToken(tenantId: string, id: string): Promise<boolean> {
  if (!(await assertEditable(tenantId, id))) return false
  const { data } = await admin().from('proposals').update({ public_token_revoked_at: now(), updated_at: now() }).eq('tenant_id', tenantId).eq('id', id).select('id').maybeSingle()
  return !!data
}

// ── Public (token) side — service role, NO auth guard. Customer-safe shapes only (never cost/internal). ──
export interface PublicProposal { number: string; status: string; businessName: string; supportEmail: string | null; supportPhone: string | null; customerName: string | null; currency: string; subtotal_cents: number; discount_cents: number; tax_cents: number; total_cents: number; customer_notes: string | null; terms: string | null; expires_at: string | null; is_expired: boolean; accepted_at: string | null; declined_at: string | null; lines: PublicLine[] }
export interface PublicLine { description: string | null; quantity: number; unit_price_cents: number; discount_cents: number; line_total_cents: number; sku: string | null; image_url: string | null; attributes: Record<string, unknown> }

export async function resolvePublicProposal(rawToken: string, opts: { recordView?: boolean } = {}): Promise<PublicProposal | null> {
  const { data: doc } = await admin().from('proposals').select('*').eq('public_token_hash', hashToken(rawToken)).is('public_token_revoked_at', null).maybeSingle()
  if (!doc) return null
  const expired = !!doc.expires_at && new Date(doc.expires_at as string) < new Date() && !['accepted', 'declined', 'converted'].includes(doc.status as string)
  if (opts.recordView) {
    const patch: Record<string, unknown> = { last_viewed_at: now(), view_count: ((doc.view_count as number) ?? 0) + 1 }
    if (!doc.first_viewed_at) patch.first_viewed_at = now()
    if (doc.status === 'sent') patch.status = 'viewed'
    if (expired && (doc.status === 'sent' || doc.status === 'viewed')) { patch.status = 'expired'; patch.expired_at = now() }
    await admin().from('proposals').update(patch).eq('id', doc.id)
    if (doc.status === 'sent' && !expired) await admin().from('document_status_history').insert({ tenant_id: doc.tenant_id, document_type: 'proposal', document_id: doc.id, from_status: 'sent', to_status: 'viewed', actor: null, note: 'Customer opened the proposal' })
  }
  const brand = await tenantBranding(doc.tenant_id as string)
  const contact = doc.contact_id ? (await admin().from('contacts').select('name').eq('id', doc.contact_id).maybeSingle()).data : null
  const { data: lines } = await admin().from('sales_document_lines').select('description, quantity, unit_price_cents, discount_cents, line_total_cents, custom_attributes').eq('document_type', 'proposal').eq('document_id', doc.id).order('sort_order')
  return {
    number: doc.number as string, status: expired ? 'expired' : (doc.status as string), businessName: brand.businessName, supportEmail: brand.email, supportPhone: brand.phone,
    customerName: (contact?.name as string) ?? null, currency: doc.currency as string,
    subtotal_cents: doc.subtotal_cents as number, discount_cents: doc.discount_cents as number, tax_cents: doc.tax_cents as number, total_cents: doc.total_cents as number,
    customer_notes: (doc.customer_notes as string) ?? null, terms: (doc.terms as string) ?? null, expires_at: (doc.expires_at as string) ?? null, is_expired: expired,
    accepted_at: (doc.accepted_at as string) ?? null, declined_at: (doc.declined_at as string) ?? null,
    lines: ((lines ?? []) as Record<string, unknown>[]).map((l) => { const a = (l.custom_attributes as Record<string, unknown>) ?? {}; return {
      description: (l.description as string) ?? null, quantity: l.quantity as number, unit_price_cents: l.unit_price_cents as number, discount_cents: (l.discount_cents as number) ?? 0, line_total_cents: l.line_total_cents as number,
      sku: (a.sku as string) ?? null, image_url: (a.image_url as string) ?? null, attributes: (a.attributes as Record<string, unknown>) ?? {},
    } }),
  }
}

export async function respondToProposal(rawToken: string, action: 'accept' | 'decline', input: { name?: string | null; email?: string | null; reason?: string | null }): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const { data: doc } = await admin().from('proposals').select('id, tenant_id, number, status, expires_at, accepted_at, declined_at').eq('public_token_hash', hashToken(rawToken)).is('public_token_revoked_at', null).maybeSingle()
  if (!doc) return { ok: false, error: 'not_found' }
  if (doc.status === 'converted') return { ok: false, error: 'already_converted' }
  if (doc.accepted_at || doc.declined_at) return { ok: false, error: 'already_responded' }
  if (doc.expires_at && new Date(doc.expires_at as string) < new Date()) return { ok: false, error: 'expired' }
  const patch = action === 'accept'
    ? { status: 'accepted', accepted_at: now(), accepted_by_name: input.name ?? null, accepted_by_email: input.email ?? null }
    : { status: 'declined', declined_at: now(), declined_by_name: input.name ?? null, declined_by_email: input.email ?? null, decline_reason: input.reason ?? null }
  await admin().from('proposals').update({ ...patch, updated_at: now() }).eq('id', doc.id)
  await admin().from('document_status_history').insert({ tenant_id: doc.tenant_id, document_type: 'proposal', document_id: doc.id, from_status: doc.status, to_status: patch.status, actor: null, note: `Customer ${action}ed${input.name ? ` (${input.name})` : ''}` })
  // Owner notification (best-effort)
  const brand = await tenantBranding(doc.tenant_id as string)
  if (brand.email) await sendEmail(brand.email, `Proposal ${doc.number} ${action}ed`, `<p>Proposal <strong>${doc.number}</strong> was ${action}ed${input.name ? ` by ${input.name}` : ''}${input.email ? ` (${input.email})` : ''}.${input.reason ? ` Reason: ${input.reason}` : ''}</p>`, { tenantId: doc.tenant_id as string }).catch(() => {})
  return { ok: true, status: patch.status }
}

// ── Conversion (no re-entry: copies everything) ────────────────────────────────────────────────────────
export async function convertProposalToInvoice(tenantId: string, actor: string, id: string): Promise<{ ok: true; invoiceId: string; idempotent: boolean; number?: string } | { ok: false; error: string }> {
  if ((await resolveProposalType(tenantId, id)) !== 'proposal') return { ok: false, error: 'not_a_proposal' }
  const res = await convertDocument(tenantId, 'proposal', id, 'invoice', `conv:proposal:${id}:invoice`, actor)
  if (!res.ok || !res.target_id) return { ok: false, error: res.error || 'convert_failed' }
  await admin().from('proposals').update({ converted_invoice_id: res.target_id, converted_at: now(), status: 'converted', updated_at: now() }).eq('tenant_id', tenantId).eq('id', id)
  return { ok: true, invoiceId: res.target_id, idempotent: !!res.idempotent, number: res.number }
}

// Proposal -> legacy Order (the existing furniture/fulfilment system the Commerce "Orders" tab points at).
// Guarded against duplicate conversion via converted_order_id; an Order may later create its own Invoice.
export async function convertProposalToOrder(tenantId: string, actor: string, id: string): Promise<{ ok: true; orderId: string; orderNumber: string; idempotent: boolean } | { ok: false; error: string }> {
  if ((await resolveProposalType(tenantId, id)) !== 'proposal') return { ok: false, error: 'not_a_proposal' }
  const { data: doc } = await admin().from('proposals').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (!doc) return { ok: false, error: 'not_found' }
  if (doc.converted_order_id) { const { data: o } = await admin().from('orders').select('order_number').eq('id', doc.converted_order_id).maybeSingle(); return { ok: true, orderId: doc.converted_order_id as string, orderNumber: (o?.order_number as string) ?? '', idempotent: true } }
  const contact = doc.contact_id ? (await admin().from('contacts').select('name, phone, email').eq('id', doc.contact_id).maybeSingle()).data : null
  const orderNumber = generateOrderNumber()
  const { data: order, error: oerr } = await admin().from('orders').insert({
    tenant_id: tenantId, order_number: orderNumber, contact_id: doc.contact_id ?? null,
    customer_name: (contact?.name as string) ?? null, customer_email: (contact?.email as string) ?? null, customer_phone: (contact?.phone as string) ?? null,
    subtotal_cents: doc.subtotal_cents, currency: doc.currency, internal_notes: doc.internal_notes ?? null, public_notes: doc.customer_notes ?? null, created_by: actor,
  }).select('id').single()
  if (oerr || !order) return { ok: false, error: oerr?.message || 'order_create_failed' }
  const { data: lines } = await admin().from('sales_document_lines').select('*').eq('tenant_id', tenantId).eq('document_type', 'proposal').eq('document_id', id).order('sort_order')
  if ((lines ?? []).length) {
    await admin().from('order_line_items').insert(((lines ?? []) as Record<string, unknown>[]).map((l) => { const a = (l.custom_attributes as Record<string, unknown>) ?? {}
      return {
        tenant_id: tenantId, order_id: order.id, product_name: (l.description as string) || 'Item', description: (l.description as string) ?? null,
        sku: (a.sku as string) ?? null, quantity: l.quantity, unit_price_cents: l.unit_price_cents, line_total_cents: l.line_total_cents, product_ref: (l.product_id as string) ?? null,
        measurements: (a.dimensions as string) ?? null, color: (a.color as string) ?? null, material: (a.fabric as string) ?? (a.material as string) ?? null,
        display_order: (l.sort_order as number) ?? 0,
      } }))
  }
  await admin().from('orders').update({ subtotal_cents: doc.subtotal_cents }).eq('id', order.id)
  await admin().from('order_events').insert({ tenant_id: tenantId, order_id: order.id, type: 'created', actor: 'system', payload: { from_proposal: doc.number } })
  await admin().from('proposals').update({ converted_order_id: order.id, converted_at: now(), status: 'converted', updated_at: now() }).eq('tenant_id', tenantId).eq('id', id)
  await admin().from('document_status_history').insert({ tenant_id: tenantId, document_type: 'proposal', document_id: id, from_status: doc.status, to_status: 'converted', actor, note: `Converted to order ${orderNumber}` })
  return { ok: true, orderId: order.id as string, orderNumber, idempotent: false }
}
