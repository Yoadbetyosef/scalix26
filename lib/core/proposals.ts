import { createAdminClient } from '@/lib/supabase/server'
import { lineTotalCents, proposalTotals } from './money'
import { convertDocument } from './convert'
import { generateProposalToken, hashToken } from './proposal-token'
import { generateOrderNumber } from '@/lib/orders/order-number'
import { sendEmail } from '@/lib/email/send'
import { proposalEmailHtml } from './proposal-email'
import { getBranding } from './proposal-branding'
import { logActivity, listActivity } from './proposal-activity'
import { resolveLineSnapshot, assembleRenderable, TEMPLATES, type RenderableProposal, type ProposalTemplate } from './proposal-render'
import { getMaterial, materialSnapshot } from './materials'
import { editableFor, lockReasonFor } from './proposal-status'
export { PROPOSAL_STATUSES, type ProposalStatus, editableFor, lockReasonFor } from './proposal-status'

// Unified Proposals layer. A `proposals` row is the going-forward sales document; legacy `estimates` and
// `quotes` rows stay fully readable through the same list/detail so no history is lost. Only NEW proposals
// are editable/sendable/convertible here — legacy docs are shown read-only, keeping their type internally.
const admin = () => createAdminClient()
const now = () => new Date().toISOString()

export type ProposalLegacyType = 'proposal' | 'estimate' | 'quote'

// ── Reads ────────────────────────────────────────────────────────────────────────────────────────────
async function expireStale(tenantId: string) {
  await admin().from('proposals').update({ status: 'expired', expired_at: now() })
    .eq('tenant_id', tenantId).in('status', ['sent', 'viewed']).not('expires_at', 'is', null).lt('expires_at', now())
}

export interface UnifiedRow { id: string; legacy_type: ProposalLegacyType; number: string; title: string | null; status: string; contact_id: string | null; company_id: string | null; customer_name: string | null; company_name: string | null; customer_email: string | null; currency: string; total_cents: number; expires_at: string | null; converted: boolean; created_at: string; updated_at: string }
export interface ListFilter { search?: string; status?: string; converted?: 'yes' | 'no'; type?: ProposalLegacyType }

export async function listProposals(tenantId: string, filter: ListFilter = {}, limit = 300): Promise<UnifiedRow[]> {
  await expireStale(tenantId)
  const cols = 'id, number, status, contact_id, company_id, currency, total_cents, created_at, updated_at'
  const [p, e, q, contacts, companies] = await Promise.all([
    admin().from('proposals').select(`${cols}, expires_at, title, converted_invoice_id, converted_order_id`).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(limit),
    admin().from('estimates').select(cols).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(limit),
    admin().from('quotes').select(cols).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(limit),
    admin().from('contacts').select('id, name, email').eq('tenant_id', tenantId),
    admin().from('companies').select('id, name').eq('tenant_id', tenantId),
  ])
  const cById = new Map((contacts.data ?? []).map((c) => [c.id as string, c as { name: string | null; email: string | null }]))
  const coById = new Map((companies.data ?? []).map((c) => [c.id as string, (c.name as string) ?? null]))
  const enrich = (r: Record<string, unknown>, type: ProposalLegacyType): UnifiedRow => {
    const c = r.contact_id ? cById.get(r.contact_id as string) : null
    return {
      id: r.id as string, legacy_type: type, number: r.number as string, title: (r.title as string) ?? null, status: r.status as string,
      contact_id: (r.contact_id as string) ?? null, company_id: (r.company_id as string) ?? null,
      customer_name: c?.name ?? null, company_name: r.company_id ? coById.get(r.company_id as string) ?? null : null, customer_email: c?.email ?? null,
      currency: r.currency as string, total_cents: r.total_cents as number, expires_at: (r.expires_at as string) ?? null,
      converted: !!(r.converted_invoice_id || r.converted_order_id), created_at: r.created_at as string, updated_at: r.updated_at as string,
    }
  }
  let rows: UnifiedRow[] = [
    ...(p.data ?? []).map((r) => enrich(r as Record<string, unknown>, 'proposal')),
    ...(e.data ?? []).map((r) => enrich(r as Record<string, unknown>, 'estimate')),
    ...(q.data ?? []).map((r) => enrich(r as Record<string, unknown>, 'quote')),
  ]
  const s = filter.search?.trim().toLowerCase()
  if (s) rows = rows.filter((r) => [r.number, r.title, r.customer_name, r.company_name, r.customer_email].some((v) => v?.toLowerCase().includes(s)))
  if (filter.status) rows = rows.filter((r) => r.status === filter.status)
  if (filter.type) rows = rows.filter((r) => r.legacy_type === filter.type)
  if (filter.converted === 'yes') rows = rows.filter((r) => r.converted)
  if (filter.converted === 'no') rows = rows.filter((r) => !r.converted)
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit)
}

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
  const [{ data: doc }, { data: lines }] = await Promise.all([
    admin().from(TABLE[type]).select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle(),
    admin().from('sales_document_lines').select('*').eq('tenant_id', tenantId).eq('document_type', type).eq('document_id', id).order('sort_order'),
  ])
  if (!doc) return null
  let contact = null, company = null
  if (doc.contact_id) contact = (await admin().from('contacts').select('id, name, phone, email, address').eq('tenant_id', tenantId).eq('id', doc.contact_id).maybeSingle()).data ?? null
  if (doc.company_id) company = (await admin().from('companies').select('id, name').eq('tenant_id', tenantId).eq('id', doc.company_id).maybeSingle()).data ?? null
  const activity = type === 'proposal' ? await listActivity(tenantId, id) : []
  const { data: sections } = type === 'proposal'
    ? await admin().from('proposal_sections').select('id, title, body, sort_order, visible').eq('tenant_id', tenantId).eq('proposal_id', id).order('sort_order')
    : { data: [] }
  const status = doc.status as string
  const legacyReadOnly = type !== 'proposal'
  return {
    type, editable: type === 'proposal' && editableFor(status), legacyReadOnly,
    lockReason: type === 'proposal' ? lockReasonFor(status) : 'Legacy record — read-only for history.',
    document: doc, lines: lines ?? [], contact, company, activity, sections: sections ?? [],
  }
}

// Intelligent default title: "[Customer] Proposal" / "[Company] Proposal", else null.
async function defaultTitle(tenantId: string, contactId?: string | null, companyId?: string | null): Promise<string | null> {
  if (contactId) { const { data } = await admin().from('contacts').select('name').eq('tenant_id', tenantId).eq('id', contactId).maybeSingle(); if (data?.name) return `${(data.name as string).trim()} Proposal` }
  if (companyId) { const { data } = await admin().from('companies').select('name').eq('tenant_id', tenantId).eq('id', companyId).maybeSingle(); if (data?.name) return `${(data.name as string).trim()} Proposal` }
  return null
}

// ── Create / duplicate ───────────────────────────────────────────────────────────────────────────────
export async function createProposal(tenantId: string, actor: string, input: { contactId?: string | null; companyId?: string | null; currency?: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data: num, error: nerr } = await admin().rpc('core_next_document_number', { p_tenant: tenantId, p_doc_type: 'proposal' })
  if (nerr) return { ok: false, error: nerr.message }
  const { data, error } = await admin().from('proposals').insert({
    tenant_id: tenantId, number: num as string, title: await defaultTitle(tenantId, input.contactId, input.companyId), contact_id: input.contactId ?? null, company_id: input.companyId ?? null,
    currency: input.currency ?? 'usd', status: 'draft', template: 'clean', salesperson_id: actor, created_by: actor,
  }).select('id').single()
  if (error) return { ok: false, error: error.message }
  await logActivity(tenantId, data.id as string, 'created', { actor, message: `Proposal ${num} created` })
  return { ok: true, id: data.id as string }
}

export async function duplicateProposal(tenantId: string, actor: string, id: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const src = await getProposal(tenantId, id)
  if (!src) return { ok: false, error: 'not_found' }
  const created = await createProposal(tenantId, actor, { contactId: src.document.contact_id as string | null, companyId: src.document.company_id as string | null, currency: src.document.currency as string })
  if (!created.ok) return created
  await admin().from('proposals').update({
    customer_notes: src.document.customer_notes ?? null, internal_notes: src.document.internal_notes ?? null,
    terms: src.document.terms ?? null, expires_at: src.document.expires_at ?? null, template: src.document.template ?? 'clean',
    overall_discount_cents: src.document.overall_discount_cents ?? 0, tax_cents: src.document.tax_cents ?? 0, updated_at: now(),
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
  await logActivity(tenantId, created.id, 'duplicated', { actor, message: `Duplicated from ${src.document.number}` })
  return { ok: true, id: created.id }
}

// ── Editability guards ───────────────────────────────────────────────────────────────────────────────
async function proposalStatus(tenantId: string, id: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  const type = await resolveProposalType(tenantId, id)
  if (type !== 'proposal') return { ok: false, error: 'not_editable' }
  const { data } = await admin().from('proposals').select('status').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: 'not_found' }
  const status = data.status as string
  if (!editableFor(status)) return { ok: false, error: 'locked' }
  return { ok: true, status }
}
// After a content change on a sent/viewed proposal, mark it + log (version safety).
async function noteEditAfterSend(tenantId: string, id: string, status: string, actor: string, what: string) {
  if (status === 'sent' || status === 'viewed') {
    await admin().from('proposals').update({ updated_after_send_at: now() }).eq('tenant_id', tenantId).eq('id', id)
    await logActivity(tenantId, id, 'updated_after_send', { actor, message: `${what} after the proposal was sent` })
  }
}

// ── Autosave (proposal-only header fields) ───────────────────────────────────────────────────────────
export interface ProposalPatch { title?: string | null; scope?: string | null; contactId?: string | null; companyId?: string | null; currency?: string; status?: string; salespersonId?: string | null; expiresAt?: string | null; customerNotes?: string | null; internalNotes?: string | null; terms?: string | null; overallDiscountCents?: number; taxCents?: number; template?: string; notes?: string | null }
const PATCH_MAP: Record<keyof ProposalPatch, string> = { title: 'title', scope: 'scope', contactId: 'contact_id', companyId: 'company_id', currency: 'currency', status: 'status', salespersonId: 'salesperson_id', expiresAt: 'expires_at', customerNotes: 'customer_notes', internalNotes: 'internal_notes', terms: 'terms', overallDiscountCents: 'overall_discount_cents', taxCents: 'tax_cents', template: 'template', notes: 'notes' }

export async function updateProposal(tenantId: string, id: string, patch: ProposalPatch, actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const st = await proposalStatus(tenantId, id)
  if (!st.ok) return { ok: false, error: st.error! }
  if (patch.contactId) { const { data } = await admin().from('contacts').select('id').eq('tenant_id', tenantId).eq('id', patch.contactId).maybeSingle(); if (!data) return { ok: false, error: 'contact_not_found' } }
  if (patch.companyId) { const { data } = await admin().from('companies').select('id').eq('tenant_id', tenantId).eq('id', patch.companyId).maybeSingle(); if (!data) return { ok: false, error: 'company_not_found' } }
  const upd: Record<string, unknown> = { updated_at: now() }
  for (const k of Object.keys(patch) as (keyof ProposalPatch)[]) if (patch[k] !== undefined) upd[PATCH_MAP[k]] = patch[k]
  // Backfill a default title when the customer changes and no title has been set yet.
  if ('contactId' in patch && patch.title === undefined) {
    const { data: cur } = await admin().from('proposals').select('title').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
    if (cur && !(cur.title as string)?.trim()) { const dt = await defaultTitle(tenantId, patch.contactId, patch.companyId ?? undefined); if (dt) upd.title = dt }
  }
  const { error } = await admin().from('proposals').update(upd).eq('tenant_id', tenantId).eq('id', id)
  if (error) return { ok: false, error: error.message }
  if (patch.overallDiscountCents !== undefined || patch.taxCents !== undefined) await recomputeTotals(tenantId, id)
  if ('contactId' in patch || 'companyId' in patch) await logActivity(tenantId, id, 'customer_changed', { actor, message: 'Customer updated' })
  if (patch.template !== undefined) await logActivity(tenantId, id, 'template_changed', { actor, message: `Template set to ${patch.template}` })
  const contentEdit = ['customerNotes', 'terms', 'expiresAt', 'overallDiscountCents', 'taxCents', 'template', 'contactId'].some((k) => k in patch)
  if (contentEdit) await noteEditAfterSend(tenantId, id, st.status!, actor, 'Details changed')
  return { ok: true }
}

// ── Lines (server-resolved catalog snapshots) ────────────────────────────────────────────────────────
export interface ProposalLineInput { productId?: string | null; variantId?: string | null; componentId?: string | null; fabricId?: string | null; description?: string | null; quantity: number; unit_price_cents: number; discount_cents?: number }

export async function addProposalLine(tenantId: string, id: string, line: ProposalLineInput, actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const st = await proposalStatus(tenantId, id)
  if (!st.ok) return { ok: false, error: st.error! }
  const snapshot = (line.productId || line.componentId || line.variantId) ? await resolveLineSnapshot(tenantId, line) : null
  // Fabric/material snapshot — copied onto the line so it survives later catalog changes.
  let fabric: Record<string, unknown> | null = null
  if (line.fabricId) { const m = await getMaterial(tenantId, line.fabricId); if (m) fabric = materialSnapshot(m) }
  const custom: Record<string, unknown> = snapshot ? { snapshot, sku: snapshot.sku, image_url: snapshot.image_url } : {}
  if (fabric) custom.fabric = fabric
  const { count } = await admin().from('sales_document_lines').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('document_type', 'proposal').eq('document_id', id)
  const { error } = await admin().from('sales_document_lines').insert({
    tenant_id: tenantId, document_type: 'proposal', document_id: id, product_id: line.productId ?? null, variant_id: line.variantId ?? null, component_id: line.componentId ?? null,
    description: line.description ?? snapshot?.product_name ?? null, quantity: line.quantity, unit_price_cents: line.unit_price_cents,
    discount_cents: line.discount_cents ?? 0, tax_cents: 0, line_total_cents: lineTotalCents({ quantity: line.quantity, unit_price_cents: line.unit_price_cents, discount_cents: line.discount_cents ?? 0 }),
    custom_attributes: custom, sort_order: count ?? 0,
  })
  if (error) return { ok: false, error: error.message }
  await recomputeTotals(tenantId, id)
  await logActivity(tenantId, id, 'item_added', { actor, message: `Added ${line.description ?? snapshot?.product_name ?? 'item'}` })
  await noteEditAfterSend(tenantId, id, st.status!, actor, 'An item was added')
  return { ok: true }
}

export async function updateProposalLine(tenantId: string, id: string, lineId: string, patch: { description?: string | null; quantity?: number; unit_price_cents?: number; discount_cents?: number }, actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const st = await proposalStatus(tenantId, id)
  if (!st.ok) return { ok: false, error: st.error! }
  const { data: cur } = await admin().from('sales_document_lines').select('quantity, unit_price_cents, discount_cents').eq('tenant_id', tenantId).eq('document_id', id).eq('id', lineId).maybeSingle()
  if (!cur) return { ok: false, error: 'line_not_found' }
  const merged = { quantity: patch.quantity ?? (cur.quantity as number), unit_price_cents: patch.unit_price_cents ?? (cur.unit_price_cents as number), discount_cents: patch.discount_cents ?? (cur.discount_cents as number) }
  const upd: Record<string, unknown> = { ...merged, line_total_cents: lineTotalCents(merged) }
  if (patch.description !== undefined) upd.description = patch.description
  const { error } = await admin().from('sales_document_lines').update(upd).eq('tenant_id', tenantId).eq('document_id', id).eq('id', lineId)
  if (error) return { ok: false, error: error.message }
  await recomputeTotals(tenantId, id)
  await logActivity(tenantId, id, 'item_edited', { actor, message: 'An item was edited' })
  await noteEditAfterSend(tenantId, id, st.status!, actor, 'An item was edited')
  return { ok: true }
}

export async function removeProposalLine(tenantId: string, id: string, lineId: string, actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const st = await proposalStatus(tenantId, id)
  if (!st.ok) return { ok: false, error: st.error! }
  await admin().from('sales_document_lines').delete().eq('tenant_id', tenantId).eq('document_type', 'proposal').eq('document_id', id).eq('id', lineId)
  await recomputeTotals(tenantId, id)
  await logActivity(tenantId, id, 'item_removed', { actor, message: 'An item was removed' })
  await noteEditAfterSend(tenantId, id, st.status!, actor, 'An item was removed')
  return { ok: true }
}

// Image controls for a proposal line: hide the image, upload a proposal-specific image, or clear it.
export async function setLineImage(tenantId: string, id: string, lineId: string, patch: { hide?: boolean; proposalImageUrl?: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  const st = await proposalStatus(tenantId, id)
  if (!st.ok) return { ok: false, error: st.error! }
  const { data: cur } = await admin().from('sales_document_lines').select('custom_attributes').eq('tenant_id', tenantId).eq('document_id', id).eq('id', lineId).maybeSingle()
  if (!cur) return { ok: false, error: 'line_not_found' }
  const a = { ...((cur.custom_attributes as Record<string, unknown>) ?? {}) }
  if (patch.hide !== undefined) a.hide_image = patch.hide
  if (patch.proposalImageUrl !== undefined) a.proposal_image_url = patch.proposalImageUrl
  const { error } = await admin().from('sales_document_lines').update({ custom_attributes: a }).eq('tenant_id', tenantId).eq('document_id', id).eq('id', lineId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

async function recomputeTotals(tenantId: string, id: string) {
  const [{ data: lines }, { data: hdr }] = await Promise.all([
    admin().from('sales_document_lines').select('quantity, unit_price_cents, discount_cents').eq('tenant_id', tenantId).eq('document_type', 'proposal').eq('document_id', id),
    admin().from('proposals').select('overall_discount_cents, tax_cents').eq('tenant_id', tenantId).eq('id', id).maybeSingle(),
  ])
  const t = proposalTotals((lines ?? []) as { quantity: number; unit_price_cents: number; discount_cents: number }[], (hdr?.overall_discount_cents as number) ?? 0, (hdr?.tax_cents as number) ?? 0)
  await admin().from('proposals').update({ subtotal_cents: t.subtotal_cents, discount_cents: t.discount_cents, total_cents: t.total_cents, updated_at: now() }).eq('tenant_id', tenantId).eq('id', id)
}

// ── Send (branded email + secure token). Provider success is the ONLY thing that flips status to sent. ──
async function lineThumbnails(tenantId: string, id: string): Promise<string[]> {
  const { data: lines } = await admin().from('sales_document_lines').select('custom_attributes').eq('tenant_id', tenantId).eq('document_type', 'proposal').eq('document_id', id).order('sort_order').limit(6)
  const urls: string[] = []
  for (const l of (lines ?? []) as { custom_attributes: Record<string, unknown> | null }[]) {
    const a = l.custom_attributes ?? {}
    if (a.hide_image === true) continue
    const u = (a.proposal_image_url as string) || ((a.snapshot as { image_url?: string })?.image_url) || (a.image_url as string) || null
    if (u) urls.push(u)
  }
  return [...new Set(urls)].slice(0, 4)
}

export interface SendInput { recipientEmail: string; recipientName?: string | null; cc?: string | null; subject?: string | null; message?: string | null; baseUrl: string }
export async function sendProposal(tenantId: string, actor: string, id: string, input: SendInput): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  const st = await proposalStatus(tenantId, id)
  if (!st.ok) return { ok: false, error: st.error! }
  const { data: doc } = await admin().from('proposals').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (!doc) return { ok: false, error: 'not_found' }

  await logActivity(tenantId, id, 'email_attempted', { actor, message: `Sending to ${input.recipientEmail}` })
  const { token, hash } = generateProposalToken()
  const brand = await getBranding(tenantId)
  const contact = doc.contact_id ? (await admin().from('contacts').select('name').eq('id', doc.contact_id).maybeSingle()).data : null
  const link = `${input.baseUrl.replace(/\/$/, '')}/proposals/${token}`
  const fmt = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: (doc.currency as string) || 'usd' }).format(c / 100)
  const html = proposalEmailHtml({
    businessName: brand.business_name, customerName: input.recipientName ?? (contact?.name as string) ?? null, proposalNumber: doc.number as string,
    summary: input.message ?? (doc.customer_notes as string) ?? brand.default_email_message ?? null, thumbnails: await lineThumbnails(tenantId, id),
    totalFormatted: fmt(doc.total_cents as number), expiresOn: doc.expires_at ? String(doc.expires_at).slice(0, 10) : null, link, supportEmail: brand.email,
  })
  const subject = input.subject?.trim() || brand.default_email_subject?.trim() || `Your proposal ${doc.number} from ${brand.business_name}`
  // Send FIRST — only persist token + sent state on provider acceptance.
  const res = await sendEmail(input.recipientEmail, subject, html, { tenantId, fromName: brand.business_name, replyTo: brand.email ?? undefined, cc: input.cc?.trim() || undefined }).catch((e) => ({ success: false as const, error: (e as Error).message }))
  if (!res.success) {
    await logActivity(tenantId, id, 'email_failed', { actor, message: ('error' in res && res.error) || 'Email provider rejected the send' })
    return { ok: false, error: ('error' in res && res.error) || 'send_failed' }
  }
  await admin().from('proposals').update({ public_token_hash: hash, public_token: token, public_token_revoked_at: null, sent_at: doc.sent_at ?? now(), last_emailed_to: input.recipientEmail, status: 'sent', updated_at: now() }).eq('tenant_id', tenantId).eq('id', id)
  await admin().from('document_status_history').insert({ tenant_id: tenantId, document_type: 'proposal', document_id: id, from_status: doc.status, to_status: 'sent', actor, note: `Sent to ${input.recipientEmail}` })
  await logActivity(tenantId, id, 'email_sent', { actor, message: `Sent to ${input.recipientEmail}` })
  return { ok: true, link }
}

export async function revokeProposalToken(tenantId: string, id: string): Promise<boolean> {
  if ((await resolveProposalType(tenantId, id)) !== 'proposal') return false
  const { data } = await admin().from('proposals').update({ public_token_revoked_at: now(), updated_at: now() }).eq('tenant_id', tenantId).eq('id', id).select('id').maybeSingle()
  return !!data
}

// Log an internal preview open (never a customer view).
export async function logPreview(tenantId: string, id: string, actor: string): Promise<void> {
  if ((await resolveProposalType(tenantId, id)) === 'proposal') await logActivity(tenantId, id, 'previewed', { actor, message: 'Previewed internally' })
}

// ── Public (token) side — service role, NO auth guard. Returns the shared renderable (customer-safe). ──
export async function resolvePublicProposal(rawToken: string, opts: { recordView?: boolean; internalTenantId?: string | null } = {}): Promise<RenderableProposal | null> {
  const { data: doc } = await admin().from('proposals').select('*').eq('public_token_hash', hashToken(rawToken)).is('public_token_revoked_at', null).maybeSingle()
  if (!doc) return null
  const expired = !!doc.expires_at && new Date(doc.expires_at as string) < new Date() && !['accepted', 'declined', 'converted'].includes(doc.status as string)
  // An authenticated owner of this tenant is previewing — never record a customer view.
  const isInternal = !!opts.internalTenantId && opts.internalTenantId === doc.tenant_id
  if (opts.recordView && !isInternal) {
    const patch: Record<string, unknown> = { last_viewed_at: now(), view_count: ((doc.view_count as number) ?? 0) + 1 }
    if (!doc.first_viewed_at) patch.first_viewed_at = now()
    if (doc.status === 'sent') patch.status = 'viewed'
    if (expired && (doc.status === 'sent' || doc.status === 'viewed')) { patch.status = 'expired'; patch.expired_at = now() }
    await admin().from('proposals').update(patch).eq('id', doc.id)
    if (doc.status === 'sent' && !expired) {
      await admin().from('document_status_history').insert({ tenant_id: doc.tenant_id, document_type: 'proposal', document_id: doc.id, from_status: 'sent', to_status: 'viewed', actor: null, note: 'Customer opened the proposal' })
      await logActivity(doc.tenant_id as string, doc.id as string, 'viewed', { message: 'Customer opened the proposal' })
    }
  }
  const contact = doc.contact_id ? (await admin().from('contacts').select('name, email, phone, address').eq('id', doc.contact_id).maybeSingle()).data : null
  const company = doc.company_id ? (await admin().from('companies').select('name').eq('id', doc.company_id).maybeSingle()).data : null
  const [{ data: lines }, { data: sections }] = await Promise.all([
    admin().from('sales_document_lines').select('*').eq('document_type', 'proposal').eq('document_id', doc.id).order('sort_order'),
    admin().from('proposal_sections').select('title, body, sort_order, visible').eq('tenant_id', doc.tenant_id as string).eq('proposal_id', doc.id).order('sort_order'),
  ])
  return assembleRenderable(doc.tenant_id as string, doc as Record<string, unknown>, (lines ?? []) as Record<string, unknown>[], contact, company, (sections ?? []) as Record<string, unknown>[])
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
  await logActivity(doc.tenant_id as string, doc.id as string, action === 'accept' ? 'accepted' : 'declined', { message: `Customer ${action}ed${input.name ? ` (${input.name})` : ''}`, meta: { email: input.email ?? null } })
  const brand = await getBranding(doc.tenant_id as string)
  if (brand.email) await sendEmail(brand.email, `Proposal ${doc.number} ${action}ed`, `<p>Proposal <strong>${doc.number}</strong> was ${action}ed${input.name ? ` by ${input.name}` : ''}${input.email ? ` (${input.email})` : ''}.${input.reason ? ` Reason: ${input.reason}` : ''}</p>`, { tenantId: doc.tenant_id as string }).catch(() => {})
  return { ok: true, status: patch.status }
}

// ── Conversion ─────────────────────────────────────────────────────────────────────────────────────
export async function convertProposalToInvoice(tenantId: string, actor: string, id: string): Promise<{ ok: true; invoiceId: string; idempotent: boolean; number?: string } | { ok: false; error: string }> {
  if ((await resolveProposalType(tenantId, id)) !== 'proposal') return { ok: false, error: 'not_a_proposal' }
  const res = await convertDocument(tenantId, 'proposal', id, 'invoice', `conv:proposal:${id}:invoice`, actor)
  if (!res.ok || !res.target_id) return { ok: false, error: res.error || 'convert_failed' }
  await admin().from('proposals').update({ converted_invoice_id: res.target_id, converted_at: now(), status: 'converted', updated_at: now() }).eq('tenant_id', tenantId).eq('id', id)
  if (!res.idempotent) await logActivity(tenantId, id, 'converted_invoice', { actor, message: `Converted to invoice ${res.number ?? ''}` })
  return { ok: true, invoiceId: res.target_id, idempotent: !!res.idempotent, number: res.number }
}

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
    await admin().from('order_line_items').insert(((lines ?? []) as Record<string, unknown>[]).map((l) => { const a = (l.custom_attributes as Record<string, unknown>) ?? {}; const s = (a.snapshot as Record<string, unknown>) ?? {}
      const fab = (a.fabric as Record<string, unknown>) ?? null   // selected fabric snapshot for fulfillment
      return {
        tenant_id: tenantId, order_id: order.id, product_name: (l.description as string) || (s.product_name as string) || 'Item', description: (l.description as string) ?? null,
        sku: (s.sku as string) ?? (a.sku as string) ?? null, quantity: l.quantity, unit_price_cents: l.unit_price_cents, line_total_cents: l.line_total_cents, product_ref: (l.product_id as string) ?? null,
        measurements: (s.measurements as string) ?? null, color: (fab?.color as string) ?? (s.color as string) ?? null, material: (fab?.name as string) ?? (s.fabric as string) ?? null,
        fabric: fab, display_order: (l.sort_order as number) ?? 0,
      } }))
  }
  await admin().from('order_events').insert({ tenant_id: tenantId, order_id: order.id, type: 'created', actor: 'system', payload: { from_proposal: doc.number } })
  await admin().from('proposals').update({ converted_order_id: order.id, converted_at: now(), status: 'converted', updated_at: now() }).eq('tenant_id', tenantId).eq('id', id)
  await admin().from('document_status_history').insert({ tenant_id: tenantId, document_type: 'proposal', document_id: id, from_status: doc.status, to_status: 'converted', actor, note: `Converted to order ${orderNumber}` })
  await logActivity(tenantId, id, 'converted_order', { actor, message: `Converted to order ${orderNumber}` })
  return { ok: true, orderId: order.id as string, orderNumber, idempotent: false }
}

export { TEMPLATES, type ProposalTemplate, type RenderableProposal }
