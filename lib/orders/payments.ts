import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { addEvent } from './store'
import type { Order } from './types'
import { orderTotals, sumPayments, isOrderPaymentMethod, PAYMENT_METHOD_LABELS, LEDGER_KIND, type OrderPayment, type OrderPaymentKind, type OrderPaymentMethod, type OrderTotals } from './payment-types'

export * from './payment-types'

// ── PAYMENTS AGAINST AN ORDER ─────────────────────────────────────────────────────────────────────
//
// An order used to carry ONE number about money received — `deposit_cents`, typed into the edit
// drawer. That is not a payment history: a deposit, a second instalment when the stone arrives and
// the balance at pickup were three edits to the same field, each one overwriting how the last was
// paid and when. The invoice printed whatever the field said last.
//
// ── THE LEDGER ALREADY EXISTED ──────────────────────────────────────────────────────────────────
//
// `payment_allocations` (lib/core/payments.ts) is the platform's payment ledger: one row per amount
// received, with kind, method, reference and idempotency, keyed by (document_type, document_id).
// Its RPC and CHECK constraints already admit document_type = 'order'. So an order's payments are
// rows in THAT table — not a second ledger with a second definition of "paid".
//
// What this module adds is the ORDER's reading of it:
//
//   · `deposit_cents` on the order is now DERIVED — the sum of the ledger — and kept written so
//     every existing reader (the estimate, the invoice, the list, the AI's lookups) sees the same
//     figure it always did. Nothing that reads `depositCents` had to change.
//   · totals are computed in ONE place (orderTotals) so the page, the document and the payments
//     panel cannot print three different balances. The document computed subtotal + tax − deposit
//     for itself; it now calls this.
//
// ── WHAT IS NOT STORED ───────────────────────────────────────────────────────────────────────────
//
// No card number, no CVV, no expiry — ever. `reference` is a cheque number, a transfer reference or
// a processor's transaction id; `method` says how the money arrived. A card payment taken through a
// terminal is recorded as method 'card' with the terminal's receipt reference, and nothing else.

/** The migration that teaches the ledger 'wire' and 'etransfer' and gives it a paid_on date. */
export const PAYMENTS_MIGRATION = 'add_tg_production_1.sql'

const row = (r: Record<string, unknown>): OrderPayment => {
  const kind = r.kind as string
  const method = r.method as string | null
  // 'transfer' is what the ledger stored before it learned the two Canadian words for it. Read back
  // as 'wire' — the older of the two meanings — and the note, which carries the exact wording when
  // the fallback wrote one, says which it was.
  // 'transfer' is the ledger's older word. The fallback write put the exact method at the front of
  // the note ("E-transfer — …" / "Wire transfer — …"), so it is read back from there rather than
  // guessed: an e-transfer never comes back labelled as a wire.
  const note = (r.note as string) ?? ''
  const m: OrderPaymentMethod | null = method === 'transfer'
    ? (note.startsWith(PAYMENT_METHOD_LABELS.etransfer) ? 'etransfer' : 'wire')
    : isOrderPaymentMethod(method) ? method : method ? 'other' : null
  return {
    id: r.id as string,
    kind: kind === 'deposit' ? 'deposit' : kind === 'refund' ? 'refund' : 'payment',
    amountCents: Number(r.amount_cents ?? 0),
    currency: (r.currency as string) ?? 'usd',
    method: m,
    reference: (r.provider_ref as string) ?? null,
    note: (r.note as string) ?? null,
    paidOn: (r.paid_on as string) ?? (r.created_at as string).slice(0, 10),
    createdAt: r.created_at as string,
    createdBy: (r.created_by as string) ?? null,
  }
}

/** Every payment ever recorded against the order, oldest first, for a tenant given explicitly. */
export async function listOrderPaymentsForTenant(tenantId: string, orderId: string): Promise<OrderPayment[]> {
  const { data } = await createAdminClient()
    .from('payment_allocations').select('*')
    .eq('tenant_id', tenantId).eq('document_type', 'order').eq('document_id', orderId)
    .order('created_at', { ascending: true })
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(row)
}

/** The owner-facing read: tenancy from the signed-in workspace. */
export async function listOrderPayments(orderId: string): Promise<OrderPayment[]> {
  const c = await requireActiveBusinessContext()
  if (!c) return []
  return listOrderPaymentsForTenant(c.tenantId, orderId)
}


export interface RecordPaymentInput {
  kind: OrderPaymentKind
  /** Always positive on the wire; refunds are negated here. */
  amountCents: number
  method: OrderPaymentMethod | null
  reference?: string | null
  note?: string | null
  /** YYYY-MM-DD. Omitted = today. */
  paidOn?: string | null
  /** A caller retrying the same payment sends the same key and gets the same row back. */
  idempotencyKey?: string | null
}

export interface RecordPaymentResult { ok: boolean; error?: string; payment?: OrderPayment; totals?: OrderTotals; degraded?: string }

/**
 * Record money received (or refunded) against an order and write the running total back to the
 * order row.
 *
 * ── WHY THIS DOES NOT CALL core_apply_payment ───────────────────────────────────────────────────
 *
 * The RPC computes an order's total from subtotal_cents alone — it predates the tax snapshot — so
 * its returned status would call a fully paid taxable order "overpaid". The insert is the same row
 * the RPC would write; the arithmetic is orderTotals, which knows about tax. Idempotency is kept by
 * the same column the RPC uses, so a key written by either path is honoured by both.
 */
export async function recordOrderPayment(orderId: string, input: RecordPaymentInput): Promise<RecordPaymentResult> {
  const c = await requireActiveBusinessContext()
  if (!c) return { ok: false, error: 'Not signed in' }
  const amount = Math.round(Math.abs(input.amountCents))
  if (!amount) return { ok: false, error: 'Enter an amount.' }

  const sb = await createClient()
  const { data: o } = await sb.from('orders').select('*').eq('tenant_id', c.tenantId).eq('id', orderId).maybeSingle()
  if (!o) return { ok: false, error: 'Order not found' }
  if (o.stage === 'cancelled') return { ok: false, error: 'This order is cancelled. Record a refund on the invoice it produced, or reopen the order first.' }

  const db = createAdminClient()
  if (input.idempotencyKey) {
    const { data: dupe } = await db.from('payment_allocations').select('*')
      .eq('tenant_id', c.tenantId).eq('idempotency_key', input.idempotencyKey).maybeSingle()
    if (dupe) {
      // A retry after the ledger row landed but the order's running total did not: recompute and
      // write it again, so the retry HEALS the half-done write rather than reporting it as done.
      const payments = await listOrderPaymentsForTenant(c.tenantId, orderId)
      const paid = sumPayments(payments)
      await writeRunningTotal(db, c.tenantId, orderId, Number(o.subtotal_cents ?? 0), paid)
      return { ok: true, payment: row(dupe as Record<string, unknown>), totals: orderTotals(orderShape(o), { paidCents: paid }) }
    }
  }

  const reference = (input.reference ?? '').trim() || null
  const note = (input.note ?? '').trim() || null
  const paidOn = (input.paidOn ?? '').trim() || new Date().toISOString().slice(0, 10)

  // ── AN ORDER FROM BEFORE THE LEDGER ─────────────────────────────────────────────────────────────
  //
  // Its deposit is a typed number with no row behind it. The moment a second payment is recorded the
  // total becomes "the sum of the rows", and the typed deposit would silently vanish from it. So the
  // typed figure is carried into the ledger FIRST, as its own row, and only then is the new payment
  // added. add_tg_production_1.sql does the same for every such order at once; this is the same
  // conversion for a database where it has not been run yet.
  await carryLegacyDeposit(db, c.tenantId, orderId, o)
  const base = {
    tenant_id: c.tenantId, document_type: 'order', document_id: orderId,
    kind: LEDGER_KIND[input.kind],
    amount_cents: input.kind === 'refund' ? -amount : amount,
    currency: (o.currency as string) ?? 'usd',
    provider_ref: reference, note, idempotency_key: input.idempotencyKey ?? null, created_by: c.actorUserId,
  }

  // Written with the two new columns first; retried without them if the ledger has not been taught
  // them yet. Nothing about the AMOUNT is lost either way — the method falls back to the ledger's
  // older word for a transfer and the exact one is kept in the note, and the date falls back to today.
  let degraded: string | undefined
  let { data, error } = await db.from('payment_allocations')
    .insert({ ...base, method: input.method, paid_on: paidOn }).select('*').single()
  if (error && (error.code === '23514' || error.code === '42703' || error.code === 'PGRST204')) {
    const legacyMethod = input.method === 'wire' || input.method === 'etransfer' ? 'transfer' : input.method
    const legacyNote = input.method === 'wire' || input.method === 'etransfer'
      ? [PAYMENT_METHOD_LABELS[input.method], note].filter(Boolean).join(' — ')
      : note
    ;({ data, error } = await db.from('payment_allocations')
      .insert({ ...base, method: legacyMethod, note: legacyNote }).select('*').single())
    if (!error) { console.warn(`[payments] method/date stored in fallback form — ${PAYMENTS_MIGRATION} part 2 not applied`); degraded = `Recorded as a transfer dated today — "${input.method ? PAYMENT_METHOD_LABELS[input.method] : 'the method'}" and the exact date will be kept once extended payment methods are enabled on this account.` }
  }
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not record the payment.' }

  const payments = await listOrderPaymentsForTenant(c.tenantId, orderId)
  const paid = sumPayments(payments)
  const totals = orderTotals(orderShape(o), { paidCents: paid })
  // deposit_cents = everything received; balance_cents keeps its historical meaning (subtotal minus
  // deposit) because readers that predate the tax snapshot still compare it to the subtotal.
  //
  // ── IF THIS WRITE FAILS ──────────────────────────────────────────────────────────────────────
  // The ledger row exists (the money is recorded) and the order's cached total is stale. Every
  // surface that prints money reads the LEDGER — the order page, the customer history, and the
  // document loader (loadOrderDocument re-derives deposit from the ledger) — so nothing misprints;
  // and the next payment, or a retry with the same idempotency key, rewrites the cache.
  const cached = await writeRunningTotal(db, c.tenantId, orderId, Number(o.subtotal_cents ?? 0), paid)
  if (!cached.ok) console.error('[orders/payments] ledger row written but running total not cached', orderId, cached.error)
  await addEvent(orderId, 'payment_recorded', {
    kind: input.kind, amountCents: input.kind === 'refund' ? -amount : amount, method: input.method, reference, paidOn,
    paidCents: paid, dueCents: totals.dueCents,
  })
  return { ok: true, payment: row(data as Record<string, unknown>), totals, degraded }
}

/** The cached running total on the order row: deposit_cents = ledger sum, balance_cents = subtotal − it. */
async function writeRunningTotal(db: ReturnType<typeof createAdminClient>, tenantId: string, orderId: string, subtotalCents: number, paidCents: number): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.from('orders').update({ deposit_cents: paidCents, balance_cents: subtotalCents - paidCents, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', orderId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** The typed deposit on an order that predates the ledger becomes a ledger row, once. */
async function carryLegacyDeposit(db: ReturnType<typeof createAdminClient>, tenantId: string, orderId: string, o: Record<string, unknown>): Promise<void> {
  const typed = Number(o.deposit_cents ?? 0)
  if (typed <= 0) return
  const { count } = await db.from('payment_allocations').select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('document_type', 'order').eq('document_id', orderId)
  if (count) return
  const key = `legacy-deposit:${orderId}`
  const base = {
    tenant_id: tenantId, document_type: 'order', document_id: orderId, kind: 'deposit', amount_cents: typed,
    currency: (o.currency as string) ?? 'usd', note: LEGACY_DEPOSIT_NOTE, idempotency_key: key, created_by: null,
  }
  const { error } = await db.from('payment_allocations').insert({ ...base, paid_on: (o.order_date as string) ?? (o.created_at as string).slice(0, 10) })
  if (error && (error.code === '42703' || error.code === 'PGRST204')) await db.from('payment_allocations').insert(base)
}
export const LEGACY_DEPOSIT_NOTE = 'Deposit recorded before payment history existed'

/** Only the fields orderTotals reads, off a raw row. */
function orderShape(o: Record<string, unknown>): Pick<Order, 'subtotalCents' | 'depositCents' | 'deliveryProvince' | 'taxLabel' | 'taxRatePercent'> {
  return {
    subtotalCents: Number(o.subtotal_cents ?? 0), depositCents: Number(o.deposit_cents ?? 0),
    deliveryProvince: (o.delivery_province as string) ?? null, taxLabel: (o.tax_label as string) ?? null,
    taxRatePercent: o.tax_rate_percent === null || o.tax_rate_percent === undefined ? null : Number(o.tax_rate_percent),
  }
}

/**
 * Remove a payment that was recorded in error. The order's running total is recomputed from what
 * remains, and the removal is on the timeline — so the history still says a payment was entered and
 * withdrawn, rather than pretending it never was.
 */
export async function deleteOrderPayment(orderId: string, paymentId: string): Promise<RecordPaymentResult> {
  const c = await requireActiveBusinessContext()
  if (!c) return { ok: false, error: 'Not signed in' }
  const db = createAdminClient()
  const { data: gone, error } = await db.from('payment_allocations').delete()
    .eq('tenant_id', c.tenantId).eq('document_type', 'order').eq('document_id', orderId).eq('id', paymentId)
    .select('*')
  if (error) return { ok: false, error: error.message }
  if (!gone?.length) return { ok: false, error: 'That payment no longer exists.' }
  const { data: o } = await db.from('orders').select('*').eq('tenant_id', c.tenantId).eq('id', orderId).maybeSingle()
  if (!o) return { ok: false, error: 'Order not found' }
  const payments = await listOrderPaymentsForTenant(c.tenantId, orderId)
  const paid = sumPayments(payments)
  await writeRunningTotal(db, c.tenantId, orderId, Number(o.subtotal_cents ?? 0), paid)
  const removed = row(gone[0] as Record<string, unknown>)
  await addEvent(orderId, 'payment_removed', { amountCents: removed.amountCents, method: removed.method, reference: removed.reference, paidCents: paid })
  return { ok: true, totals: orderTotals(orderShape(o), { paidCents: paid }) }
}
