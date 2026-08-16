import { createAdminClient } from '@/lib/supabase/server'
import { derivePaymentStatus, type PaymentStatus } from './payments'

// THE INVOICE LIST AND ONE INVOICE — docs/miles/invoices-income.html.
//
// Read-only. Everything a screen needs, in two queries for the list and three for one invoice, with
// the money DERIVED rather than stored: `paid` is the sum of allocations and `outstanding` is total
// minus paid, computed here from rows the database holds. Nothing caches a balance, so nothing can
// disagree with the ledger it came from.
//
// ── OVERDUE IS A DATE SOMEBODY AGREED, NOT ARITHMETIC ───────────────────────────────────────────
//
// `due_on` is stamped ONTO the invoice at issue from the tenant's net terms, so it is a fact about
// that document rather than a sum this file performs. An invoice with NO due date is never overdue —
// null means nobody agreed one, which is different from "not yet late" and very different from
// "late". The four rows that predate the column stay out of the group for exactly that reason.

export type Bucket = 'overdue' | 'waiting' | 'draft' | 'paid'

export interface InvoiceRow {
  id: string
  number: string
  who: string
  /** The line under the name: what it is, or what happened to it last. */
  sub: string
  totalCents: number
  paidCents: number
  outstandingCents: number
  status: PaymentStatus
  bucket: Bucket
  /** 0–1, for the part-paid bar. Null unless partly paid — a bar at 0 or 100 says nothing. */
  progress: number | null
  currency: string
  issuedAt: string | null
  createdAt: string
  /** The agreed date, or null when none was. Null is never overdue. */
  dueOn: string | null
  /** Negative = late by that many days. Null when there is no due date to be late against. */
  daysToDue: number | null
}

export interface InvoiceGroup { key: Bucket; label: string; rows: InvoiceRow[] }

export interface InvoiceList {
  groups: InvoiceGroup[]
  /** The band. Issued THIS MONTH — a running total since the beginning of time is not a figure. */
  sentCents: number
  sentCount: number
  receivedCents: number
  receivedCount: number
  outstandingCents: number
  outstandingCount: number
  overdueCents: number
  overdueCount: number
  currency: string
}

const GROUP_LABEL: Record<Bucket, string> = {
  overdue: 'OVERDUE',
  waiting: 'WAITING TO BE PAID',
  draft: 'DRAFTS',
  paid: 'PAID',
}
/** The order the reference draws them: what is wrong, what is owed, what is unfinished, what is done. */
const ORDER: Bucket[] = ['overdue', 'waiting', 'draft', 'paid']

interface Head {
  id: string; number: string; status: string; currency: string; total_cents: number
  contact_id: string | null; company_id: string | null; notes: string | null
  issued_at: string | null; created_at: string; due_on: string | null
}

/** Whole days from today to the due date, in UTC — `due_on` is a plain date and has no time in it. */
function daysUntil(dueOn: string | null): number | null {
  if (!dueOn) return null
  const today = new Date().toISOString().slice(0, 10)
  return Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}
interface Alloc { document_id: string; amount_cents: number; kind: string; method: string | null; created_at: string; provider_ref: string | null; note: string | null }

const money = (c: number) => c / 100

/** "Sent 3 days ago" · "Created 2 days ago" — the relative form the reference uses on the sub-line. */
function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export async function readInvoiceList(tenantId: string): Promise<InvoiceList> {
  const db = createAdminClient()

  const [{ data: heads }, { data: allocs }] = await Promise.all([
    db.from('invoices')
      .select('id, number, status, currency, total_cents, contact_id, company_id, notes, issued_at, created_at, due_on')
      .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(200),
    db.from('payment_allocations')
      .select('document_id, amount_cents, kind, method, created_at, provider_ref, note')
      .eq('tenant_id', tenantId).eq('document_type', 'invoice'),
  ])

  const invoices = (heads ?? []) as unknown as Head[]
  const paidBy = new Map<string, number>()
  for (const a of (allocs ?? []) as unknown as Alloc[]) {
    paidBy.set(a.document_id, (paidBy.get(a.document_id) ?? 0) + Number(a.amount_cents))
  }

  // Who each invoice is for. One read for all of them rather than one per row.
  const contactIds = [...new Set(invoices.map((i) => i.contact_id).filter((x): x is string => !!x))]
  const companyIds = [...new Set(invoices.map((i) => i.company_id).filter((x): x is string => !!x))]
  const [{ data: contacts }, { data: companies }] = await Promise.all([
    contactIds.length
      ? db.from('contacts').select('id, name, phone, email').eq('tenant_id', tenantId).in('id', contactIds)
      : Promise.resolve({ data: [] }),
    companyIds.length
      ? db.from('companies').select('id, name').eq('tenant_id', tenantId).in('id', companyIds)
      : Promise.resolve({ data: [] }),
  ])
  const contactById = new Map((contacts ?? []).map((c) => [c.id as string, c as { name?: string | null; phone?: string | null; email?: string | null }]))
  const companyById = new Map((companies ?? []).map((c) => [c.id as string, (c as { name?: string | null }).name ?? null]))

  const rows: InvoiceRow[] = invoices.map((inv) => {
    const total = Number(inv.total_cents ?? 0)
    const paid = paidBy.get(inv.id) ?? 0
    const status = derivePaymentStatus(total, paid)
    const isDraft = inv.status === 'draft'

    const days = daysUntil(inv.due_on)
    // Overdue is a real state and it outranks "waiting": money that is late is a different problem
    // from money that is merely owed. A paid invoice is never overdue however old the date is, and an
    // invoice with no due date never becomes overdue at all.
    const late = !isDraft && status !== 'paid' && days !== null && days < 0
    const bucket: Bucket = isDraft ? 'draft' : status === 'paid' ? 'paid' : late ? 'overdue' : 'waiting'

    const c = inv.contact_id ? contactById.get(inv.contact_id) : null
    const who = companyById.get(inv.company_id ?? '') || c?.name?.trim() || c?.phone?.trim() || c?.email?.trim() || 'No customer yet'

    const sub = isDraft
      ? `Not issued · created ${ago(inv.created_at)}`
      : status === 'partial'
        ? `${inv.number} · part paid`
        : status === 'paid'
          ? `${inv.number} · paid`
          : `${inv.number} · issued ${inv.issued_at ? ago(inv.issued_at) : ago(inv.created_at)}`

    return {
      id: inv.id,
      number: inv.number,
      who,
      sub,
      totalCents: total,
      paidCents: paid,
      outstandingCents: total - paid,
      status,
      bucket,
      // A bar at 0 or 100 says nothing the number beside it does not already say.
      progress: status === 'partial' && total > 0 ? paid / total : null,
      currency: inv.currency || 'usd',
      issuedAt: inv.issued_at,
      createdAt: inv.created_at,
      dueOn: inv.due_on,
      daysToDue: days,
    }
  })

  // ── The band ────────────────────────────────────────────────────────────────────────────────
  //
  // SENT is issued THIS MONTH. A running total since the beginning of time is not a figure anybody
  // acts on, and the reference says "this month" under it. RECEIVED counts allocations in the same
  // window. OUTSTANDING is every unpaid issued invoice regardless of when — money owed does not stop
  // being owed at a month boundary.
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const since = monthStart.getTime()

  const issued = rows.filter((r) => r.bucket !== 'draft')
  const sentThisMonth = issued.filter((r) => r.issuedAt && new Date(r.issuedAt).getTime() >= since)
  const receivedThisMonth = ((allocs ?? []) as unknown as Alloc[])
    .filter((a) => new Date(a.created_at).getTime() >= since)
  const owed = issued.filter((r) => r.outstandingCents > 0)
  const late = rows.filter((r) => r.bucket === 'overdue')

  const groups = ORDER
    .map((key) => ({ key, label: GROUP_LABEL[key], rows: rows.filter((r) => r.bucket === key) }))
    .filter((g) => g.rows.length > 0)

  return {
    groups,
    sentCents: sentThisMonth.reduce((s, r) => s + r.totalCents, 0),
    sentCount: sentThisMonth.length,
    receivedCents: receivedThisMonth.reduce((s, a) => s + Number(a.amount_cents), 0),
    receivedCount: receivedThisMonth.length,
    outstandingCents: owed.reduce((s, r) => s + r.outstandingCents, 0),
    outstandingCount: owed.length,
    overdueCents: late.reduce((s, r) => s + r.outstandingCents, 0),
    overdueCount: late.length,
    currency: rows[0]?.currency ?? 'usd',
  }
}

// ── One invoice ─────────────────────────────────────────────────────────────────────────────────

export interface InvoiceLine { id: string; description: string; quantity: number; unitPriceCents: number; lineTotalCents: number }
export interface InvoicePayment { id: string; method: string | null; kind: string; amountCents: number; at: string; ref: string | null; note: string | null }
export interface InvoiceEvent { at: string; from: string | null; to: string; note: string | null }

export interface InvoiceDetail {
  row: InvoiceRow
  subtotalCents: number
  discountCents: number
  taxCents: number
  lines: InvoiceLine[]
  payments: InvoicePayment[]
  history: InvoiceEvent[]
  contact: { name: string | null; phone: string | null; email: string | null } | null
  /** SNAPSHOTTED at issue. A draft shows the tenant's current settings instead — see the page. */
  paymentInstructions: string | null
}

export async function readInvoice(tenantId: string, id: string): Promise<InvoiceDetail | null> {
  const db = createAdminClient()
  const { data: inv } = await db.from('invoices')
    .select('id, number, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, contact_id, company_id, notes, issued_at, created_at, due_on, payment_instructions')
    .eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (!inv) return null

  const [{ data: lines }, { data: allocs }, { data: hist }, { data: contact }] = await Promise.all([
    db.from('sales_document_lines')
      .select('id, description, quantity, unit_price_cents, line_total_cents')
      .eq('tenant_id', tenantId).eq('document_type', 'invoice').eq('document_id', id).order('sort_order'),
    db.from('payment_allocations')
      .select('id, method, kind, amount_cents, created_at, provider_ref, note')
      .eq('tenant_id', tenantId).eq('document_type', 'invoice').eq('document_id', id).order('created_at'),
    db.from('document_status_history')
      .select('created_at, from_status, to_status, note')
      .eq('tenant_id', tenantId).eq('document_type', 'invoice').eq('document_id', id).order('created_at', { ascending: false }),
    inv.contact_id
      ? db.from('contacts').select('name, phone, email').eq('tenant_id', tenantId).eq('id', inv.contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const total = Number(inv.total_cents ?? 0)
  const paid = ((allocs ?? []) as { amount_cents: number }[]).reduce((s, a) => s + Number(a.amount_cents), 0)
  const status = derivePaymentStatus(total, paid)
  const isDraft = inv.status === 'draft'

  const c = contact as { name?: string | null; phone?: string | null; email?: string | null } | null
  const who = c?.name?.trim() || c?.phone?.trim() || c?.email?.trim() || 'No customer yet'

  return {
    row: {
      id: inv.id as string,
      number: inv.number as string,
      who,
      sub: isDraft ? `Not issued · created ${ago(inv.created_at as string)}` : `Issued ${inv.issued_at ? ago(inv.issued_at as string) : ago(inv.created_at as string)}`,
      totalCents: total,
      paidCents: paid,
      outstandingCents: total - paid,
      status,
      bucket: isDraft ? 'draft' : status === 'paid' ? 'paid'
        : (daysUntil((inv.due_on as string) ?? null) ?? 0) < 0 ? 'overdue' : 'waiting',
      progress: status === 'partial' && total > 0 ? paid / total : null,
      currency: (inv.currency as string) || 'usd',
      issuedAt: inv.issued_at as string | null,
      createdAt: inv.created_at as string,
      dueOn: (inv.due_on as string) ?? null,
      daysToDue: daysUntil((inv.due_on as string) ?? null),
    },
    subtotalCents: Number(inv.subtotal_cents ?? 0),
    discountCents: Number(inv.discount_cents ?? 0),
    taxCents: Number(inv.tax_cents ?? 0),
    lines: ((lines ?? []) as Record<string, unknown>[]).map((l) => ({
      id: l.id as string,
      description: (l.description as string) || 'Item',
      quantity: Number(l.quantity ?? 1),
      unitPriceCents: Number(l.unit_price_cents ?? 0),
      lineTotalCents: Number(l.line_total_cents ?? 0),
    })),
    payments: ((allocs ?? []) as Record<string, unknown>[]).map((a) => ({
      id: a.id as string,
      method: (a.method as string) ?? null,
      kind: (a.kind as string) || 'charge',
      amountCents: Number(a.amount_cents ?? 0),
      at: a.created_at as string,
      ref: (a.provider_ref as string) ?? null,
      note: (a.note as string) ?? null,
    })),
    history: ((hist ?? []) as Record<string, unknown>[]).map((h) => ({
      at: h.created_at as string,
      from: (h.from_status as string) ?? null,
      to: h.to_status as string,
      // A note is how a create that half-succeeded survives the sheet closing — see invoices/new.tsx.
      note: (h.note as string) ?? null,
    })),
    contact: c ? { name: c.name ?? null, phone: c.phone ?? null, email: c.email ?? null } : null,
    paymentInstructions: (inv.payment_instructions as string) ?? null,
  }
}

export { money }
