import { createAdminClient } from '@/lib/supabase/server'
import { normalizeEmail, normalizePhone } from '@/lib/contacts/store'
import { orderStatusGroup, STAGE_LABELS, type OrderStage, type OrderStatusGroup } from '@/lib/orders/stages'
import { memoStatusLabel, type Memo } from '@/lib/memos/types'
import { ORDER_KIND_LABELS, isOrderKind, type OrderKind } from '@/lib/orders/kinds'

// ── ONE CUSTOMER, THE WHOLE STORY ───────────────────────────────────────────────────────────────
//
// The contact page showed conversations and nothing else. The estimate she did not take, the ring
// that was made, the invoice, the deposit, the appointment — all in the system, none on the person.
// So a returning customer was looked up in the inbox and remembered from there.
//
// This reads everything that is ABOUT a contact, tenant-scoped, and returns it in a shape the page
// can print in one column. Two rules:
//
//   · orders are matched by contact_id AND by the customer's email or phone typed on the order —
//     because 21 of 36 orders were typed as walk-ins before orders learned to link themselves,
//     and those must not vanish from the history the day the link is fixed;
//   · a closed-no-sale estimate is here on exactly the same footing as a finished order. It is the
//     most common thing a jeweller has on a customer, and "we quoted you a 1.2ct oval in March" is
//     the sentence that turns a returning enquiry into a sale.

export interface HistoryOrder {
  id: string; orderNumber: string; stage: OrderStage; group: OrderStatusGroup; stageLabel: string
  createdAt: string; updatedAt: string
  subtotalCents: number; depositCents: number; currency: string
  invoicedAt: string | null
  /** The first line's product name, as the one-line summary of what the order was for. */
  summary: string | null
  /** Linked by id, or found by the email/phone typed on the order. */
  via: 'contact' | 'email' | 'phone'
  /** custom / repair / appraisal / stock — 'custom' on a database without the column. */
  kind: OrderKind
  kindLabel: string | null
  /** Documents the customer was actually sent, oldest first: "Estimate · 12 Sep". */
  sent: Array<{ docType: string; at: string }>
}
export interface HistoryAppointment {
  id: string; slotDate: string; slotTime: string | null; serviceType: string | null; status: string | null; meetingKind: string | null
}
export interface HistoryPayment {
  id: string; orderId: string; orderNumber: string; kind: string; amountCents: number; currency: string; method: string | null; paidOn: string
}
export interface HistoryMemo { id: string; itemDescription: string; statusLabel: string; movedOn: string; dueOn: string | null; settled: boolean }
export interface CustomerHistory {
  orders: HistoryOrder[]
  appointments: HistoryAppointment[]
  payments: HistoryPayment[]
  memos: HistoryMemo[]
  totals: { orders: number; active: number; closed: number; noSale: number; spentCents: number }
}

export async function readCustomerHistory(
  tenantId: string,
  contact: { id: string; email?: string | null; phone?: string | null },
): Promise<CustomerHistory> {
  const db = createAdminClient()
  const email = normalizeEmail(contact.email)
  const phone = normalizePhone(contact.phone)

  // '*' so a database without order_kind still answers; the kind is read off the row with a fallback.
  const cols = '*'
  const filters = [`contact_id.eq.${contact.id}`]
  if (email) filters.push(`customer_email.ilike.${email.replace(/[%,()]/g, '')}`)
  if (phone) filters.push(`customer_phone.ilike.%${phone}`)

  const [{ data: orderRows }, { data: apptRows }, memoRes] = await Promise.all([
    db.from('orders').select(cols).eq('tenant_id', tenantId).or(filters.join(',')).order('created_at', { ascending: false }).limit(500),
    db.from('appointments').select('id, slot_date, slot_time, service_type, status, meeting_kind').eq('tenant_id', tenantId).eq('contact_id', contact.id).order('slot_date', { ascending: false }).limit(100),
    // Absent until add_tg_production_1.sql part 4: an error here is an empty list, not a failed page.
    db.from('memos').select('id, item_description, status, direction, kind, moved_on, due_on').eq('tenant_id', tenantId).eq('contact_id', contact.id).order('created_at', { ascending: false }).limit(100),
  ])
  const rows = (orderRows as Array<Record<string, unknown>> | null) ?? []
  const ids = rows.map((r) => r.id as string)

  const [{ data: lineRows }, { data: payRows }, { data: shareRows }] = ids.length
    ? await Promise.all([
        db.from('order_line_items').select('order_id, product_name, display_order').in('order_id', ids).order('display_order'),
        // '*' so a ledger without paid_on (migration pending) still answers.
        db.from('payment_allocations').select('*').eq('tenant_id', tenantId).eq('document_type', 'order').in('document_id', ids).order('created_at', { ascending: false }),
        db.from('order_document_shares').select('order_id, doc_type, sent_at, created_at').eq('tenant_id', tenantId).in('order_id', ids).order('created_at', { ascending: true }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }]
  const sentByOrder = new Map<string, Array<{ docType: string; at: string }>>()
  for (const r of (shareRows as Array<Record<string, unknown>> | null) ?? []) {
    const oid = r.order_id as string
    sentByOrder.set(oid, [...(sentByOrder.get(oid) ?? []), { docType: r.doc_type as string, at: ((r.sent_at ?? r.created_at) as string) }])
  }

  const firstLine = new Map<string, string>()
  for (const l of (lineRows as Array<Record<string, unknown>> | null) ?? []) {
    const oid = l.order_id as string
    if (!firstLine.has(oid)) firstLine.set(oid, l.product_name as string)
  }
  const numberOf = new Map(rows.map((r) => [r.id as string, r.order_number as string]))

  const orders: HistoryOrder[] = rows.map((r) => {
    const stage = r.stage as OrderStage
    const via: HistoryOrder['via'] = r.contact_id === contact.id ? 'contact'
      : email && normalizeEmail(r.customer_email as string) === email ? 'email' : 'phone'
    return {
      id: r.id as string, orderNumber: r.order_number as string, stage, group: orderStatusGroup(stage),
      stageLabel: STAGE_LABELS[stage] ?? stage,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string,
      subtotalCents: Number(r.subtotal_cents ?? 0), depositCents: Number(r.deposit_cents ?? 0), currency: (r.currency as string) ?? 'usd',
      invoicedAt: (r.invoiced_at as string) ?? null,
      summary: firstLine.get(r.id as string) ?? null,
      via,
      kind: isOrderKind(r.order_kind) ? r.order_kind : 'custom',
      kindLabel: isOrderKind(r.order_kind) && r.order_kind !== 'custom' ? ORDER_KIND_LABELS[r.order_kind] : null,
      sent: sentByOrder.get(r.id as string) ?? [],
    }
  })
  const payments: HistoryPayment[] = ((payRows as Array<Record<string, unknown>> | null) ?? []).map((p) => ({
    id: p.id as string, orderId: p.document_id as string, orderNumber: numberOf.get(p.document_id as string) ?? '',
    kind: p.kind as string, amountCents: Number(p.amount_cents ?? 0), currency: (p.currency as string) ?? 'usd',
    method: (p.method as string) ?? null, paidOn: (p.paid_on as string) ?? (p.created_at as string).slice(0, 10),
  }))
  const appointments: HistoryAppointment[] = ((apptRows as Array<Record<string, unknown>> | null) ?? []).map((a) => ({
    id: a.id as string, slotDate: a.slot_date as string, slotTime: (a.slot_time as string) ?? null,
    serviceType: (a.service_type as string) ?? null, status: (a.status as string) ?? null, meetingKind: (a.meeting_kind as string) ?? null,
  }))

  // Money actually received across closed and live orders — the ledger where it exists, else the
  // typed deposit on orders that predate it (never both for one order).
  const paidByOrder = new Map<string, number>()
  for (const p of payments) paidByOrder.set(p.orderId, (paidByOrder.get(p.orderId) ?? 0) + p.amountCents)
  const spentCents = orders.reduce((s, o) => s + (paidByOrder.has(o.id) ? paidByOrder.get(o.id)! : o.depositCents), 0)

  const memos: HistoryMemo[] = memoRes.error ? [] : ((memoRes.data as Array<Record<string, unknown>> | null) ?? []).map((r) => ({
    id: r.id as string, itemDescription: r.item_description as string,
    statusLabel: memoStatusLabel(r.status as Memo['status'], r.direction as Memo['direction'], r.kind as Memo['kind']),
    movedOn: r.moved_on as string, dueOn: (r.due_on as string) ?? null, settled: r.status === 'sold' || r.status === 'returned',
  }))

  return {
    orders, appointments, payments, memos,
    totals: {
      orders: orders.length,
      active: orders.filter((o) => o.group === 'active').length,
      closed: orders.filter((o) => o.group === 'closed').length,
      noSale: orders.filter((o) => o.group === 'no_sale').length,
      spentCents,
    },
  }
}
