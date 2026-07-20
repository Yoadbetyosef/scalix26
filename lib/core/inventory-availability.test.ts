import { describe, it, expect } from 'vitest'
import { deriveAvailability } from './inventory'

describe('deriveAvailability', () => {
  it('in_stock when available above threshold', () => expect(deriveAvailability(10, 0)).toBe('in_stock'))
  it('low_stock when available at/under threshold but positive', () => expect(deriveAvailability(2, 0, { threshold: 5 })).toBe('low_stock'))
  it('out_of_stock when nothing available and nothing incoming', () => expect(deriveAvailability(0, 0)).toBe('out_of_stock'))
  it('incoming when none available but stock is on the way', () => expect(deriveAvailability(0, 4)).toBe('incoming'))
  it('explicit override always wins (made_to_order)', () => expect(deriveAvailability(100, 0, { explicit: 'made_to_order' })).toBe('made_to_order'))
  it('explicit discontinued wins over stock', () => expect(deriveAvailability(50, 10, { explicit: 'discontinued' })).toBe('discontinued'))
  it('discontinued flag (no explicit) reported', () => expect(deriveAvailability(0, 0, { discontinued: true })).toBe('discontinued'))
  it('threshold boundary: exactly at threshold is low_stock', () => expect(deriveAvailability(5, 0, { threshold: 5 })).toBe('low_stock'))
  it('negative available (over-reserved) treated as out/incoming', () => { expect(deriveAvailability(-1, 0)).toBe('out_of_stock'); expect(deriveAvailability(-1, 3)).toBe('incoming') })
})
