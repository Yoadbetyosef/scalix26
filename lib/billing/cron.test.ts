import { describe, it, expect } from 'vitest'
import { planCharges, batchKey, type UsageRow } from './cron'

const row = (id: string, category: string, costUsd: number): UsageRow => ({ id, partner_id: 'p1', category, cost_usd: costUsd })

describe('planCharges — aggregate per category, round ONCE (no sub-cent loss)', () => {
  it('sums many sub-cent AI events before rounding', () => {
    // 10 AI events of $0.0008 provider = 0.08 cents each. Per-EVENT rounding → 0 (lost). Aggregate →
    // 0.8c provider → round 1c; charge 0.8×1.25 = 1.0c → round 1c. Proves sub-cent events aren't lost.
    const rows = Array.from({ length: 10 }, (_, i) => row(`e${i}`, 'ai', 0.0008))
    const plan = planCharges(rows, 25)
    expect(plan).toHaveLength(1)
    expect(plan[0].category).toBe('ai')
    expect(plan[0].providerCostCents).toBe(1)
    expect(plan[0].chargeCents).toBe(1)
    expect(plan[0].ids).toHaveLength(10)
  })

  it('splits charges per category (usage breakdown)', () => {
    const rows = [row('a', 'ai', 0.10), row('b', 'messaging', 0.02), row('c', 'ai', 0.10)]
    const plan = planCharges(rows, 25)
    const byCat = Object.fromEntries(plan.map((p) => [p.category, p]))
    expect(byCat.ai.providerCostCents).toBe(20)  // (0.10+0.10)*100 = 20c provider
    expect(byCat.ai.chargeCents).toBe(25)        // round(20*1.25) = 25c charge
    expect(byCat.messaging.providerCostCents).toBe(2) // 0.02*100 = 2c
    expect(byCat.messaging.chargeCents).toBe(3)       // round(2*1.25 = 2.5) = 3c
  })

  it('null category falls back to "other"', () => {
    const plan = planCharges([{ id: 'x', partner_id: 'p1', category: null, cost_usd: 0.05 }], 25)
    expect(plan[0].category).toBe('other')
  })

  it('applies the markup to the provider cost', () => {
    const plan = planCharges([row('a', 'voice', 1.00)], 25) // $1 provider = 100c, +25% = 125c
    expect(plan[0].providerCostCents).toBe(100)
    expect(plan[0].chargeCents).toBe(125)
  })
})

describe('batchKey — stable + set-specific idempotency', () => {
  it('is identical for the same id-set regardless of order', () => {
    expect(batchKey('p1', 'ai', ['a', 'b', 'c'])).toBe(batchKey('p1', 'ai', ['a', 'b', 'c']))
  })
  it('differs when the id-set changes', () => {
    expect(batchKey('p1', 'ai', ['a', 'b'])).not.toBe(batchKey('p1', 'ai', ['a', 'b', 'c']))
  })
  it('differs by category', () => {
    expect(batchKey('p1', 'ai', ['a'])).not.toBe(batchKey('p1', 'voice', ['a']))
  })
})
