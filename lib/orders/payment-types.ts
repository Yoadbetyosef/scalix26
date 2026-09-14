import { taxFromSnapshot } from '@/lib/tax/canada'
import type { Order } from './types'

// The isomorphic half of lib/orders/payments.ts — the methods, the labels, the types and the one
// arithmetic. No server imports, so the payments panel (a client component) and the document body
// can read them; the ledger writes stay in payments.ts.

export const ORDER_PAYMENT_METHODS = ['card', 'cheque', 'cash', 'wire', 'etransfer', 'other'] as const
export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number]
export const PAYMENT_METHOD_LABELS: Record<OrderPaymentMethod, string> = {
  card: 'Credit card', cheque: 'Cheque', cash: 'Cash', wire: 'Wire transfer', etransfer: 'E-transfer', other: 'Other',
}
export const isOrderPaymentMethod = (v: unknown): v is OrderPaymentMethod =>
  typeof v === 'string' && (ORDER_PAYMENT_METHODS as readonly string[]).includes(v)

/**
 * What the money was FOR. The ledger's own `kind` column is ('charge','deposit','refund','adjustment')
 * and is kept as is; these are the three the order UI offers, mapped onto it. 'payment' is a charge —
 * an instalment or the final balance — and the panel labels it from the running balance rather than
 * asking the person to classify it.
 */
export type OrderPaymentKind = 'deposit' | 'payment' | 'refund'
export const LEDGER_KIND: Record<OrderPaymentKind, 'deposit' | 'charge' | 'refund'> = { deposit: 'deposit', payment: 'charge', refund: 'refund' }

export interface OrderPayment {
  id: string
  kind: OrderPaymentKind
  /** Signed: a refund is negative. */
  amountCents: number
  currency: string
  method: OrderPaymentMethod | null
  /** Cheque number, transfer reference, terminal receipt — never card details. */
  reference: string | null
  note: string | null
  /** The date the money was received, as recorded; falls back to when the row was written. */
  paidOn: string
  createdAt: string
  createdBy: string | null
}

export const sumPayments = (payments: Array<Pick<OrderPayment, 'amountCents'>>): number =>
  payments.reduce((s, p) => s + p.amountCents, 0)

// ── THE ONE ARITHMETIC ──────────────────────────────────────────────────────────────────────────
export interface OrderTotals {
  subtotalCents: number
  taxCents: number
  /** Subtotal plus tax — what the customer owes in all. */
  totalCents: number
  /** What has been received, net of refunds. */
  paidCents: number
  /** Total minus paid. Zero when paid in full; negative when overpaid (a refund is owed). */
  dueCents: number
  status: 'unpaid' | 'partial' | 'paid' | 'overpaid'
}

/**
 * Pure. `taxCents` is whatever the document resolved (the snapshot, or the live rate for an order
 * that predates snapshots — see resolveOrderTax in document-data.ts); left out, the snapshot on the
 * order is used, which is what every order raised since the tax picker carries.
 *
 * `paidCents` defaults to the order's own `depositCents`, which is the ledger sum written back by
 * recordOrderPayment (or, on an order that predates the ledger, the figure that was typed). Passing
 * the ledger explicitly is for callers that just changed it.
 */
export function orderTotals(
  order: Pick<Order, 'subtotalCents' | 'depositCents' | 'deliveryProvince' | 'taxLabel' | 'taxRatePercent'>,
  opts: { taxCents?: number; paidCents?: number } = {},
): OrderTotals {
  const snapshot = taxFromSnapshot(order.deliveryProvince ?? null, order.taxLabel ?? null, order.taxRatePercent ?? null, order.subtotalCents)
  const taxCents = opts.taxCents ?? snapshot?.amountCents ?? 0
  const totalCents = order.subtotalCents + taxCents
  const paid = opts.paidCents ?? order.depositCents
  const dueCents = totalCents - paid
  const status: OrderTotals['status'] = paid <= 0 ? 'unpaid' : dueCents > 0 ? 'partial' : dueCents === 0 ? 'paid' : 'overpaid'
  return { subtotalCents: order.subtotalCents, taxCents, totalCents, paidCents: paid, dueCents, status }
}

