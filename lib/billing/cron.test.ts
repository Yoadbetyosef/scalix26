import { describe, it, expect } from 'vitest'
import { planCharges, batchKey, type UsageRow } from './cron'

const row = (id: string, category: string, costUsd: number, chargeCents: number): UsageRow =>
  ({ id, partner_id: 'p1', category, cost_usd: costUsd, partner_charge_cents: chargeCents })

describe('planCharges — sum SNAPSHOTTED charges per category, round ONCE', () => {
  it('sums many sub-cent AI events before rounding (not lost)', () => {
    // 10 AI events each snapshotted at 0.1c charge (0.08c provider). Per-event rounding → 0; aggregate
    // charge → 1.0c → 1; provider 0.8c → 1. Proves sub-cent snapshots survive aggregation.
    const rows = Array.from({ length: 10 }, (_, i) => row(`e${i}`, 'ai', 0.0008, 0.1))
    const plan = planCharges(rows)
    expect(plan).toHaveLength(1)
    expect(plan[0].chargeCents).toBe(1)
    expect(plan[0].providerCostCents).toBe(1)
    expect(plan[0].events).toHaveLength(10)
    expect(plan[0].events.every((e) => e.chargeCents === 0)).toBe(true) // per-event rounds to 0 (why batching matters)
  })

  it('splits per category (usage breakdown) using the frozen snapshot', () => {
    const rows = [row('a', 'ai', 0.10, 12.5), row('b', 'messaging', 0.02, 2.5), row('c', 'ai', 0.10, 12.5)]
    const plan = planCharges(rows)
    const byCat = Object.fromEntries(plan.map((p) => [p.category, p]))
    expect(byCat.ai.chargeCents).toBe(25)        // 12.5 + 12.5 = 25
    expect(byCat.ai.providerCostCents).toBe(20)  // (0.10+0.10)*100
    expect(byCat.messaging.chargeCents).toBe(3)  // round(2.5) = 3
  })

  it('treats a null snapshot charge as zero (fail-safe)', () => {
    const plan = planCharges([{ id: 'x', partner_id: 'p1', category: 'other', cost_usd: 0.01, partner_charge_cents: null }])
    expect(plan[0].chargeCents).toBe(0)
  })
})

describe('batchKey — stable, set-specific idempotency', () => {
  it('is identical for the same id-set regardless of order', () => {
    expect(batchKey('p1', 'ai', ['a', 'b', 'c'])).toBe(batchKey('p1', 'ai', ['c', 'a', 'b']))
  })
  it('differs when the id-set changes', () => {
    expect(batchKey('p1', 'ai', ['a', 'b'])).not.toBe(batchKey('p1', 'ai', ['a', 'b', 'c']))
  })
  it('differs by category', () => {
    expect(batchKey('p1', 'ai', ['a'])).not.toBe(batchKey('p1', 'voice', ['a']))
  })
})
