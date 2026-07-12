import { describe, it, expect } from 'vitest'
import { isValidTopupAmount, TOPUP_AMOUNTS_CENTS, MIN_TOPUP_CENTS, MAX_TOPUP_CENTS } from './topup'

describe('top-up amount validation', () => {
  it('accepts every preset amount', () => {
    for (const a of TOPUP_AMOUNTS_CENTS) expect(isValidTopupAmount(a)).toBe(true)
  })
  it('accepts a valid custom amount within bounds', () => {
    expect(isValidTopupAmount(7500)).toBe(true)
  })
  it('rejects below the minimum', () => {
    expect(isValidTopupAmount(MIN_TOPUP_CENTS - 1)).toBe(false)
    expect(isValidTopupAmount(0)).toBe(false)
    expect(isValidTopupAmount(-100)).toBe(false)
  })
  it('rejects above the maximum', () => {
    expect(isValidTopupAmount(MAX_TOPUP_CENTS + 1)).toBe(false)
  })
  it('rejects non-integers', () => {
    expect(isValidTopupAmount(1000.5)).toBe(false)
    expect(isValidTopupAmount(NaN)).toBe(false)
  })
})
