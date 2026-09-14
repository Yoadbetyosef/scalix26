// Memo and consignment — the isomorphic half (labels, statuses, pure transitions). No server imports.
//
// ── WHAT A MEMO IS, IN THIS SYSTEM ─────────────────────────────────────────────────────────────
//
// A piece changes hands without changing owner. Two directions:
//
//   out  OUR stock goes to a customer or dealer to consider. It leaves its location, sits in
//        `on_memo_quantity`, is unavailable to sell to anyone else, and comes BACK to stock when
//        returned — or is sold, in which case it leaves stock for good and an order carries the sale.
//
//   in   A SUPPLIER's piece comes to us on memo (or on consignment) to sell. It is entered as a
//        catalog product with ownership 'memo_in' / 'consignment' so it is never counted as ours.
//        Returned to the supplier, its quantity goes to zero and the row is archived so it no longer
//        appears available. Sold, the memo records the price and what is owed to the supplier.
//
// The word "memo" also exists in accounting as a credit memo. That is a different thing — an
// adjustment on an invoice — and nothing here is one. This module is stock in someone else's hands.
//
// ── OWNERSHIP IS A COLUMN, NEVER A STATUS ──────────────────────────────────────────────────────
//
// `owner` on the memo and `ownership` on the product are set when the memo is created and are what
// the inventory effects read. A status change alone never moves stock: every transition goes
// through lib/memos/store.ts, which writes the catalog movement and the counters in the same call.

export const MEMO_KINDS = ['memo', 'consignment'] as const
export type MemoKind = (typeof MEMO_KINDS)[number]
export const MEMO_DIRECTIONS = ['out', 'in'] as const
export type MemoDirection = (typeof MEMO_DIRECTIONS)[number]
export const MEMO_STATUSES = ['open', 'follow_up', 'pending_decision', 'sold', 'returned'] as const
export type MemoStatus = (typeof MEMO_STATUSES)[number]

export const MEMO_KIND_LABELS: Record<MemoKind, string> = { memo: 'Memo', consignment: 'Consignment' }

/** The status in words — the same status reads differently by direction ("Sent on memo" / "Received on memo"). */
export function memoStatusLabel(status: MemoStatus, direction: MemoDirection, kind: MemoKind = 'memo'): string {
  const noun = kind === 'consignment' ? 'consignment' : 'memo'
  switch (status) {
    case 'open': return direction === 'out' ? `Sent on ${noun}` : `Received on ${noun}`
    case 'follow_up': return 'Follow up needed'
    case 'pending_decision': return 'Pending decision'
    case 'sold': return 'Sold'
    case 'returned': return direction === 'out' ? 'Returned to us' : 'Returned to supplier'
  }
}

/** 'sold' and 'returned' end a memo; nothing moves out of them. */
export const isMemoSettled = (s: MemoStatus): boolean => s === 'sold' || s === 'returned'

/** Where a memo may go from where it is. The two endings are one-way. */
export function canMemoTransition(from: MemoStatus, to: MemoStatus): boolean {
  if (from === to) return false
  if (isMemoSettled(from)) return false
  return true
}

/** True when the memo is past its follow-up date and still open. */
export const memoOverdue = (m: { status: MemoStatus; dueOn: string | null }, today = new Date().toISOString().slice(0, 10)): boolean =>
  !isMemoSettled(m.status) && !!m.dueOn && m.dueOn < today

export interface Memo {
  id: string; tenantId: string; kind: MemoKind; direction: MemoDirection; status: MemoStatus
  catalogProductId: string | null; itemDescription: string; quantity: number; fromLocation: string | null
  contactId: string | null; supplierId: string | null; counterpartyName: string | null
  owner: 'company' | 'counterparty'
  agreedPriceCents: number | null; costCents: number | null; currency: string
  movedOn: string; dueOn: string | null; soldOn: string | null; returnedOn: string | null
  soldPriceCents: number | null; settledAt: string | null
  orderId: string | null; notes: string | null
  createdBy: string | null; createdAt: string; updatedAt: string
}
export interface MemoEvent { id: string; memoId: string; type: string; actor: string | null; payload: Record<string, unknown> | null; createdAt: string }

export interface MemoInput {
  kind?: MemoKind
  direction: MemoDirection
  /** An existing catalog product (required for `out`: you can only send out what you have). */
  catalogProductId?: string | null
  itemDescription?: string | null
  quantity?: number
  fromLocation?: string | null
  contactId?: string | null
  supplierId?: string | null
  counterpartyName?: string | null
  agreedPriceCents?: number | null
  costCents?: number | null
  currency?: string
  movedOn?: string | null
  dueOn?: string | null
  notes?: string | null
  /** For `in`: create the catalog row for the piece so it can be sold. Default true. */
  stockIt?: boolean
}
