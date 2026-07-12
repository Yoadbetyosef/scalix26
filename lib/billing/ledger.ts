// Normalized ledger transaction taxonomy — the single source of truth financial reports use to
// classify and reconcile every dollar. Each transaction_type maps to a money DIRECTION (credit /
// debit / signed) and a reporting BUCKET. The DB column `partner_balance_transactions.transaction_type`
// is NOT NULL + CHECK-constrained to exactly these keys, so no transaction is ever unclassified.

export type TransactionType =
  | 'top_up' | 'auto_reload' | 'usage' | 'platform_fee' | 'refund' | 'chargeback' | 'adjustment'

export type LedgerDirection = 'credit' | 'debit' | 'signed' // signed = may be + or - (manual adjustment)
export type LedgerBucket = 'funding' | 'usage' | 'fees' | 'adjustments'

export interface TxnTypeMeta {
  key: TransactionType
  label: string           // partner-safe label (no vendor names)
  direction: LedgerDirection
  bucket: LedgerBucket
}

export const TRANSACTION_TYPES: Record<TransactionType, TxnTypeMeta> = {
  top_up:       { key: 'top_up',       label: 'Balance top-up',    direction: 'credit', bucket: 'funding' },
  auto_reload:  { key: 'auto_reload',  label: 'Auto-reload',       direction: 'credit', bucket: 'funding' },
  usage:        { key: 'usage',        label: 'Usage',             direction: 'debit',  bucket: 'usage' },
  platform_fee: { key: 'platform_fee', label: 'Platform fee',      direction: 'debit',  bucket: 'fees' },
  refund:       { key: 'refund',       label: 'Refund',            direction: 'credit', bucket: 'adjustments' },
  chargeback:   { key: 'chargeback',   label: 'Chargeback',        direction: 'debit',  bucket: 'adjustments' },
  adjustment:   { key: 'adjustment',   label: 'Manual adjustment', direction: 'signed', bucket: 'adjustments' },
}

export const ALL_TRANSACTION_TYPES = Object.keys(TRANSACTION_TYPES) as TransactionType[]

export function classify(type: TransactionType): TxnTypeMeta {
  return TRANSACTION_TYPES[type]
}

// Guard: does a signed amount match the type's expected direction? (credit ≥ 0, debit ≤ 0, signed any).
// Used to assert ledger integrity in tests/reconciliation.
export function amountMatchesDirection(type: TransactionType, amountCents: number): boolean {
  const d = TRANSACTION_TYPES[type].direction
  if (d === 'credit') return amountCents >= 0
  if (d === 'debit') return amountCents <= 0
  return true
}

// Roll a set of ledger rows into per-bucket totals for reporting (money in vs out reconciles to net).
export function reconcile(rows: Array<{ transaction_type: TransactionType; amount_cents: number }>) {
  const buckets: Record<LedgerBucket, number> = { funding: 0, usage: 0, fees: 0, adjustments: 0 }
  let net = 0
  for (const r of rows) {
    buckets[TRANSACTION_TYPES[r.transaction_type].bucket] += r.amount_cents
    net += r.amount_cents
  }
  return { buckets, netCents: net }
}
