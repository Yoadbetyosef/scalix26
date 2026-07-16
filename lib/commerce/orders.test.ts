import { describe, it, expect } from 'vitest'
import { lineCoverage } from './orders'

describe('Order line coverage (§7 — buckets stay distinct)', () => {
  it('missing = ordered − allocated (never negative); buckets pass through', () => {
    expect(lineCoverage({ quantity_ordered: 4, quantity_allocated: 1, quantity_received: 0, quantity_delivered: 0 })).toEqual({ ordered: 4, allocated: 1, missing: 3, received: 0, delivered: 0 })
    expect(lineCoverage({ quantity_ordered: 2, quantity_allocated: 2, quantity_received: 1, quantity_delivered: 1 })).toEqual({ ordered: 2, allocated: 2, missing: 0, received: 1, delivered: 1 })
    // over-allocated never yields negative missing
    expect(lineCoverage({ quantity_ordered: 1, quantity_allocated: 3, quantity_received: 0, quantity_delivered: 0 }).missing).toBe(0)
  })
})
