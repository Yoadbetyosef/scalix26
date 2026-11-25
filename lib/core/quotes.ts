import { createAdminClient } from '@/lib/supabase/server'
import { lineTotalCents, documentTotals, docDiscountCents, spreadDiscount, discountLabel, type DocDiscount } from './money'
import { createDocument, addLine, setDraftDiscount, tenantSalesTax } from './documents'
import { lineTaxCents, salesTaxFor } from './sales-tax'

// ── QUOTES ──────────────────────────────────────────────────────────────────────────────────────────
//
// A quote is an offer: what it would cost, shown the way the business wants its work seen, that the
// customer can say yes to. It shares the invoice's tables (quotes + sales_document_lines) and its
// money arithmetic (lib/core/money.ts), and differs in three ways that shape everything below:
//
//   1. IT CAN BE REVISED AFTER IT IS SENT. An invoice is frozen at issue; an offer is negotiated. So
//      a quote's status stays 'draft' until it is ACCEPTED, and "sent" is a date (sent_at), not a
//      status — see add_quotes_send.sql for why that is what keeps its lines editable.
//   2. EVERY LINE CAN CARRY A PICTURE. It lives in the line's custom_attributes (image_url), so the
//      photo on a quote can be changed for this customer without touching the catalog's own.
//   3. NOBODY PAYS A QUOTE. Accepting it turns it into an invoice (quoteToInvoice), and money is
//      recorded there.

const db = () => createAdminClient()

export type QuoteState = 'draft' | 'waiting' | 'expired' | 'accepted'

export interface QuoteLine {
  id: string
  name: string
  detail: string | null
  imageUrl: string | null
  productId: string | null
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}
export interface QuoteRow {
  id: string; number: string; token: string; state: QuoteState
  who: string; contact: { id: string; name: string | null; email: string | null; phone: string | null } | null
  totalCents: number; subtotalCents: number; discountCents: number; discountPercent: number | null; discountLabel: string
  /** Sales tax on the quote, at the business's own state rate. 0 when the quote is not taxed. */
  taxCents: number
  notes: string | null; validUntil: string | null; daysLeft: number | null
  sentAt: string | null; sentChannel: string | null; acceptedAt: string | null; createdAt: string
  invoiceId: string | null
  /** Whose project it is, when the customer is a designer quoting for her own client. */
  clientName: string | null
  /** Further addresses the quote also goes to. */
  ccEmails: string[]
}
export interface Quote extends QuoteRow { lines: QuoteLine[]; history: { at: string; note: string }[] }
export interface QuoteListRow extends QuoteRow { thumbs: string[] }

const HEAD = 'id, tenant_id, number, token, status, contact_id, currency, subtotal_cents, discount_cents, discount_kind, discount_value, tax_cents, total_cents, notes, valid_until, sent_at, sent_channel, accepted_at, created_at, client_name, cc_emails'

function daysUntil(d: string | null): number | null {
  if (!d) return null
  const today = new Date().toISOString().slice(0, 10)
  return Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

/** Pure: which of the four states a quote is in. Accepted outranks everything; a date only expires an offer nobody took. */
export function quoteState(q: { status: string; sent_at: string | null; valid_until: string | null }): QuoteState {
  if (q.status === 'accepted') return 'accepted'
  if (!q.sent_at) return 'draft'
  const left = daysUntil(q.valid_until)
  return left !== null && left < 0 ? 'expired' : 'waiting'
}

type Contact = { id: string; name: string | null; email: string | null; phone: string | null }
function toRow(h: Record<string, unknown>, contact: Contact | null, invoiceId: string | null): QuoteRow {
  const kind = (h.discount_kind as string) ?? null
  const value = h.discount_value === null || h.discount_value === undefined ? null : Number(h.discount_value)
  return {
    id: h.id as string, number: h.number as string, token: h.token as string,
    state: quoteState(h as { status: string; sent_at: string | null; valid_until: string | null }),
    who: contact?.name?.trim() || contact?.email?.trim() || contact?.phone?.trim() || 'No customer yet',
    contact,
    totalCents: Number(h.total_cents ?? 0), subtotalCents: Number(h.subtotal_cents ?? 0), discountCents: Number(h.discount_cents ?? 0),
    taxCents: Number(h.tax_cents ?? 0),
    discountPercent: kind === 'percent' ? value : null,
    discountLabel: discountLabel(kind, value),
    notes: (h.notes as string) ?? null,
    validUntil: (h.valid_until as string) ?? null, daysLeft: daysUntil((h.valid_until as string) ?? null),
    sentAt: (h.sent_at as string) ?? null, sentChannel: (h.sent_channel as string) ?? null,
    acceptedAt: (h.accepted_at as string) ?? null, createdAt: h.created_at as string,
    invoiceId,
    clientName: ((h.client_name as string) ?? '').trim() || null,
    ccEmails: parseCc(h.cc_emails as string | null),
  }
}
/** Pure: the stored comma-separated list as clean, distinct addresses. */
export function parseCc(raw: string | null | undefined): string[] {
  const seen = new Set<string>()
  for (const part of (raw ?? '').split(/[,;\s]+/)) {
    const e = part.trim().toLowerCase()
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) seen.add(e)
  }
  return [...seen].slice(0, 8)
}
function toLine(l: Record<string, unknown>): QuoteLine {
  const a = (l.custom_attributes ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    id: l.id as string, name: (l.description as string) ?? '', detail: str(a.detail), imageUrl: str(a.image_url),
    productId: (l.product_id as string) ?? null,
    quantity: Number(l.quantity ?? 1), unitPriceCents: Number(l.unit_price_cents ?? 0),
    lineTotalCents: Math.round(Number(l.quantity ?? 1) * Number(l.unit_price_cents ?? 0)),
  }
}

export async function readQuoteList(tenantId: string): Promise<QuoteListRow[]> {
  const { data: heads } = await db().from('quotes').select(HEAD).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(300)
  const rows = (heads ?? []) as unknown as Record<string, unknown>[]
  if (!rows.length) return []
  const ids = rows.map((r) => r.id as string)
  const contactIds = [...new Set(rows.map((r) => r.contact_id as string | null).filter((x): x is string => !!x))]
  const [{ data: contacts }, { data: lines }, { data: invoices }] = await Promise.all([
    contactIds.length ? db().from('contacts').select('id, name, email, phone').eq('tenant_id', tenantId).in('id', contactIds) : Promise.resolve({ data: [] }),
    db().from('sales_document_lines').select('document_id, custom_attributes, sort_order').eq('tenant_id', tenantId).eq('document_type', 'quote').in('document_id', ids).order('sort_order'),
    db().from('invoices').select('id, source_document_id').eq('tenant_id', tenantId).eq('source_document_type', 'quote').in('source_document_id', ids),
  ])
  const contactById = new Map(((contacts ?? []) as Contact[]).map((c) => [c.id, c]))
  const invoiceByQuote = new Map(((invoices ?? []) as { id: string; source_document_id: string }[]).map((i) => [i.source_document_id, i.id]))
  const thumbs = new Map<string, string[]>()
  for (const l of (lines ?? []) as { document_id: string; custom_attributes: Record<string, unknown> | null }[]) {
    const url = l.custom_attributes?.image_url
    if (typeof url !== 'string' || !url) continue
    const list = thumbs.get(l.document_id) ?? []
    if (list.length < 3) { list.push(url); thumbs.set(l.document_id, list) }
  }
  return rows.map((h) => ({
    ...toRow(h, contactById.get(h.contact_id as string) ?? null, invoiceByQuote.get(h.id as string) ?? null),
    thumbs: thumbs.get(h.id as string) ?? [],
  }))
}

async function assemble(h: Record<string, unknown>): Promise<Quote> {
  const tenantId = h.tenant_id as string
  const [{ data: lines }, { data: contact }, { data: hist }, { data: inv }] = await Promise.all([
    db().from('sales_document_lines').select('id, description, quantity, unit_price_cents, product_id, custom_attributes')
      .eq('tenant_id', tenantId).eq('document_type', 'quote').eq('document_id', h.id as string).order('sort_order'),
    h.contact_id ? db().from('contacts').select('id, name, email, phone').eq('tenant_id', tenantId).eq('id', h.contact_id as string).maybeSingle() : Promise.resolve({ data: null }),
    db().from('document_status_history').select('created_at, note, from_status, to_status')
      .eq('tenant_id', tenantId).eq('document_type', 'quote').eq('document_id', h.id as string).order('created_at', { ascending: false }).limit(30),
    db().from('invoices').select('id').eq('tenant_id', tenantId).eq('source_document_type', 'quote').eq('source_document_id', h.id as string).limit(1).maybeSingle(),
  ])
  return {
    ...toRow(h, (contact as Contact | null) ?? null, (inv?.id as string) ?? null),
    lines: ((lines ?? []) as Record<string, unknown>[]).map(toLine),
    history: ((hist ?? []) as { created_at: string; note: string | null; from_status: string | null; to_status: string }[])
      .map((x) => ({ at: x.created_at, note: x.note ?? `${x.from_status ?? ''} → ${x.to_status}` })),
  }
}

export async function readQuote(tenantId: string, id: string): Promise<Quote | null> {
  const { data } = await db().from('quotes').select(HEAD).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  return data ? assemble(data as unknown as Record<string, unknown>) : null
}

// ── THE CUSTOMER'S COPY ─────────────────────────────────────────────────────────────────────────────
export interface PublicQuote extends Quote {
  logoUrl: string | null
  taxLabel: string
  business: { name: string | null; email: string | null; phone: string | null; address: string | null; city: string | null; state: string | null; zip: string | null }
}
async function withBusiness(h: Record<string, unknown>): Promise<PublicQuote> {
  const [q, { data: tenant }, { data: brand }] = await Promise.all([
    assemble(h),
    db().from('tenants').select('business_name, email, phone, address, city, state, zip').eq('id', h.tenant_id as string).maybeSingle(),
    db().from('studio_doc_settings').select('logo_url').eq('tenant_id', h.tenant_id as string).maybeSingle(),
  ])
  const t = (tenant ?? {}) as Record<string, string | null>
  return {
    ...q, history: [],
    taxLabel: salesTaxFor(t.state)?.label ?? 'Sales tax',
    logoUrl: ((brand as { logo_url?: string | null } | null)?.logo_url) ?? null,
    business: { name: t.business_name ?? null, email: t.email ?? null, phone: t.phone ?? null, address: t.address ?? null, city: t.city ?? null, state: t.state ?? null, zip: t.zip ?? null },
  }
}
/** By token, for the customer. A quote that was never sent answers exactly as a bad token does. */
export async function readPublicQuote(token: string): Promise<PublicQuote | null> {
  if (!token || token.length < 8) return null
  const { data } = await db().from('quotes').select(HEAD).eq('token', token).maybeSingle()
  if (!data || (!data.sent_at && data.status !== 'accepted')) return null
  return withBusiness(data as unknown as Record<string, unknown>)
}
/** The owner's preview — the same paper, by id, sent or not. */
export async function readQuotePaper(tenantId: string, id: string): Promise<PublicQuote | null> {
  const { data } = await db().from('quotes').select(HEAD).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  return data ? withBusiness(data as unknown as Record<string, unknown>) : null
}

// ── WRITING ─────────────────────────────────────────────────────────────────────────────────────────
export interface QuoteContent {
  contactId: string | null
  clientName?: string | null
  ccEmails?: string[]
  /** Charge sales tax at the business's state rate. Ignored when the state has no known rate. */
  taxable?: boolean
  validUntil: string | null
  notes: string | null
  discountPercent: number | null
  lines: Array<{ name: string; detail?: string | null; imageUrl?: string | null; productId?: string | null; quantity: number; unitPriceCents: number }>
}
export type QuoteWrite = { ok: true; id: string } | { ok: false; error: 'not_found' | 'accepted' | 'contact_not_found' | string }

/**
 * Save everything on a quote at once. The editor holds the whole quote, so the whole quote is what it
 * sends: the lines are replaced, the discount is spread across them exactly as an invoice's is, and
 * the header totals are recomputed from what was written rather than trusted from the browser.
 */
export async function saveQuote(tenantId: string, id: string, c: QuoteContent, actor: string): Promise<QuoteWrite> {
  const { data: head } = await db().from('quotes').select('id, status').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (!head) return { ok: false, error: 'not_found' }
  if (head.status === 'accepted') return { ok: false, error: 'accepted' }
  if (c.contactId) {
    const { data } = await db().from('contacts').select('id').eq('tenant_id', tenantId).eq('id', c.contactId).maybeSingle()
    if (!data) return { ok: false, error: 'contact_not_found' }
  }
  const lines = c.lines.filter((l) => l.name.trim())
  const gross = lines.map((l) => Math.round(l.quantity * l.unitPriceCents))
  const discount: DocDiscount | null = c.discountPercent && c.discountPercent > 0 ? { kind: 'percent', value: Math.min(100, c.discountPercent) } : null
  const parts = spreadDiscount(gross, docDiscountCents(gross.reduce((s, g) => s + g, 0), discount))
  // Tax per line, on what is left after the discount — the same sum an invoice does, so the invoice
  // made from this quote comes to the same total.
  const tax = c.taxable ? await tenantSalesTax(tenantId) : null
  const amounts = lines.map((l, i) => {
    const a = { quantity: l.quantity, unit_price_cents: l.unitPriceCents, discount_cents: parts[i] }
    return { ...a, tax_cents: tax ? lineTaxCents(a, tax.rate) : 0 }
  })

  const del = await db().from('sales_document_lines').delete().eq('tenant_id', tenantId).eq('document_type', 'quote').eq('document_id', id)
  if (del.error) return { ok: false, error: del.error.message }
  if (lines.length) {
    const ins = await db().from('sales_document_lines').insert(lines.map((l, i) => ({
      tenant_id: tenantId, document_type: 'quote', document_id: id,
      product_id: l.productId ?? null, description: l.name.trim(),
      quantity: l.quantity, unit_price_cents: l.unitPriceCents,
      discount_cents: parts[i], tax_cents: amounts[i].tax_cents, line_total_cents: lineTotalCents(amounts[i]),
      custom_attributes: { ...(l.detail?.trim() ? { detail: l.detail.trim() } : {}), ...(l.imageUrl ? { image_url: l.imageUrl } : {}) },
      sort_order: i,
    })))
    if (ins.error) return { ok: false, error: ins.error.message }
  }
  const upd = await db().from('quotes').update({
    ...documentTotals(amounts),
    contact_id: c.contactId, notes: c.notes?.trim() || null, valid_until: c.validUntil || null,
    client_name: c.clientName?.trim() || null, cc_emails: parseCc((c.ccEmails ?? []).join(',')).join(', ') || null,
    discount_kind: discount?.kind ?? null, discount_value: discount?.value ?? null,
    updated_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId).eq('id', id)
  if (upd.error) return { ok: false, error: upd.error.message }
  void actor
  return { ok: true, id }
}

export async function createQuote(tenantId: string, c: QuoteContent, actor: string): Promise<QuoteWrite> {
  const made = await createDocument(tenantId, 'quote', { contactId: c.contactId, notes: c.notes }, actor)
  if (!made.ok) return { ok: false, error: made.error }
  const id = made.document.id as string
  const saved = await saveQuote(tenantId, id, c, actor)
  // A quote whose content did not save is a numbered empty row; take it back out rather than leave it.
  if (!saved.ok) { await db().from('quotes').delete().eq('tenant_id', tenantId).eq('id', id); return saved }
  return saved
}

/** Delete a quote. Anything but an accepted one — that is a record of what a customer agreed to. */
export async function deleteQuote(tenantId: string, id: string): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'accepted' | 'failed' }> {
  const { data: head } = await db().from('quotes').select('id, status').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (!head) return { ok: false, error: 'not_found' }
  if (head.status === 'accepted') return { ok: false, error: 'accepted' }
  // Lines first here (unlike an invoice): a quote is still in draft, so the freeze trigger lets them go,
  // and removing them first means a failure leaves a quote with no lines rather than lines with no quote.
  const lines = await db().from('sales_document_lines').delete().eq('tenant_id', tenantId).eq('document_type', 'quote').eq('document_id', id)
  if (lines.error) return { ok: false, error: 'failed' }
  const gone = await db().from('quotes').delete().eq('tenant_id', tenantId).eq('id', id)
  if (gone.error) return { ok: false, error: 'failed' }
  await db().from('document_status_history').delete().eq('tenant_id', tenantId).eq('document_type', 'quote').eq('document_id', id)
  return { ok: true }
}

/** The customer says yes. By token, once; a second press, or a press on a lapsed offer, changes nothing. */
export async function acceptQuote(token: string): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'expired' }> {
  if (!token || token.length < 8) return { ok: false, error: 'not_found' }
  const { data: q } = await db().from('quotes').select('id, tenant_id, status, sent_at, valid_until').eq('token', token).maybeSingle()
  if (!q || (!q.sent_at && q.status !== 'accepted')) return { ok: false, error: 'not_found' }
  if (q.status === 'accepted') return { ok: true }
  if (quoteState(q as { status: string; sent_at: string | null; valid_until: string | null }) === 'expired') return { ok: false, error: 'expired' }
  const at = new Date().toISOString()
  const { data: done } = await db().from('quotes').update({ status: 'accepted', accepted_at: at, updated_at: at })
    .eq('id', q.id).eq('status', 'draft').select('id').maybeSingle()
  if (done) {
    await db().from('document_status_history').insert({
      tenant_id: q.tenant_id, document_type: 'quote', document_id: q.id, from_status: 'draft', to_status: 'accepted', actor: null, note: 'Accepted by the customer',
    })
  }
  return { ok: true }
}

/**
 * Turn a quote into a draft invoice: same customer, same lines (photos and all, in custom_attributes),
 * same discount, same note. A draft, so it can still be adjusted before it is issued. One invoice per
 * quote — asked twice, it answers with the one it already made.
 */
export async function quoteToInvoice(tenantId: string, id: string, actor: string): Promise<{ ok: true; invoiceId: string } | { ok: false; error: string }> {
  const q = await readQuote(tenantId, id)
  if (!q) return { ok: false, error: 'not_found' }
  if (q.invoiceId) return { ok: true, invoiceId: q.invoiceId }
  if (!q.lines.length) return { ok: false, error: 'There is nothing on this quote to invoice.' }
  const made = await createDocument(tenantId, 'invoice', { contactId: q.contact?.id ?? null, notes: q.notes }, actor)
  if (!made.ok) return { ok: false, error: made.error }
  const invoiceId = made.document.id as string
  await db().from('invoices').update({ source_document_type: 'quote', source_document_id: id }).eq('tenant_id', tenantId).eq('id', invoiceId)
  const tax = q.taxCents > 0 ? await tenantSalesTax(tenantId) : null
  for (const l of q.lines) {
    const r = await addLine(tenantId, 'invoice', invoiceId, {
      productId: l.productId, description: l.name, quantity: l.quantity, unit_price_cents: l.unitPriceCents,
      tax_cents: tax ? lineTaxCents({ quantity: l.quantity, unit_price_cents: l.unitPriceCents }, tax.rate) : 0,
      customAttributes: { ...(l.detail ? { detail: l.detail } : {}), ...(l.imageUrl ? { image_url: l.imageUrl } : {}) },
    })
    if (!r.ok) return { ok: false, error: `The invoice was started but a line did not copy (${r.error}). It is in your invoice drafts.` }
  }
  if (q.discountPercent) await setDraftDiscount(tenantId, invoiceId, { kind: 'percent', value: q.discountPercent })
  await db().from('document_status_history').insert({
    tenant_id: tenantId, document_type: 'quote', document_id: id, from_status: null, to_status: q.state === 'accepted' ? 'accepted' : 'draft', actor, note: `Invoice ${made.document.number as string} created from this quote`,
  })
  return { ok: true, invoiceId }
}
