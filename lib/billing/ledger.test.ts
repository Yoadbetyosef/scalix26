import { describe, it, expect } from 'vitest'
import {
  TRANSACTION_TYPES, ALL_TRANSACTION_TYPES, classify, amountMatchesDirection, reconcile,
  type TransactionType,
} from './ledger'

describe('transaction_type taxonomy (normalized, complete)', () => {
  it('classifies all 7 types with a direction and bucket', () => {
    expect(ALL_TRANSACTION_TYPES.length).toBe(7)
    for (const t of ALL_TRANSACTION_TYPES) {
      const m = classify(t)
      expect(m.key).toBe(t)
      expect(['credit', 'debit', 'signed']).toContain(m.direction)
      expect(['funding', 'usage', 'fees', 'adjustments']).toContain(m.bucket)
      expect(m.label.length).toBeGreaterThan(0)
    }
  })

  it('maps funding as credit and usage/fees as debit', () => {
    expect(TRANSACTION_TYPES.top_up.direction).toBe('credit')
    expect(TRANSACTION_TYPES.auto_reload.direction).toBe('credit')
    expect(TRANSACTION_TYPES.usage.direction).toBe('debit')
    expect(TRANSACTION_TYPES.platform_fee.direction).toBe('debit')
  })
})

describe('amountMatchesDirection (ledger integrity)', () => {
  it('credits must be >= 0', () => {
    expect(amountMatchesDirection('top_up', 5000)).toBe(true)
    expect(amountMatchesDirection('top_up', -5000)).toBe(false)
  })
  it('debits must be <= 0', () => {
    expect(amountMatchesDirection('usage', -100)).toBe(true)
    expect(amountMatchesDirection('usage', 100)).toBe(false)
  })
  it('signed adjustments accept either sign', () => {
    expect(amountMatchesDirection('adjustment', 500)).toBe(true)
    expect(amountMatchesDirection('adjustment', -500)).toBe(true)
  })
})

describe('reconcile (every dollar accounted, buckets + net)', () => {
  it('rolls rows into buckets and a net that equals the balance', () => {
    const rows: Array<{ transaction_type: TransactionType; amount_cents: number }> = [
      { transaction_type: 'top_up', amount_cents: 25000 },
      { transaction_type: 'auto_reload', amount_cents: 50000 },
      { transaction_type: 'usage', amount_cents: -3000 },
      { transaction_type: 'platform_fee', amount_cents: -9700 },
      { transaction_type: 'refund', amount_cents: 1000 },
    ]
    const { buckets, netCents } = reconcile(rows)
    expect(buckets.funding).toBe(75000)
    expect(buckets.usage).toBe(-3000)
    expect(buckets.fees).toBe(-9700)
    expect(buckets.adjustments).toBe(1000)
    // Net must equal the sum of every row — the reconciled balance.
    expect(netCents).toBe(25000 + 50000 - 3000 - 9700 + 1000)
    expect(netCents).toBe(buckets.funding + buckets.usage + buckets.fees + buckets.adjustments)
  })
})
