import { describe, expect, it } from 'vitest'
import { isRug, salePrice } from './pricing'

const ydc = { multiplier: 3.2, rugMultiplier: 4 }

describe('salePrice', () => {
  it('multiplies the invoice price, to whole dollars', () => {
    // ARMONIA 1,5 PL - GR: €791 × 1.2 = 949.20 → 3037.44
    expect(salePrice(949.2, false, ydc)).toBe(3037)
  })

  it('uses the rug multiple for rugs', () => {
    expect(salePrice(1101.6, true, ydc)).toBe(4406)
  })

  it('falls back to the general multiple when no rug multiple is set', () => {
    expect(salePrice(100, true, { multiplier: 3.2, rugMultiplier: null })).toBe(320)
  })

  it('prices nothing without a cost or a rule', () => {
    expect(salePrice(null, false, ydc)).toBeNull()
    expect(salePrice(0, false, ydc)).toBeNull()
    expect(salePrice(100, false, { multiplier: null, rugMultiplier: null })).toBeNull()
  })
})

describe('isRug', () => {
  it.each([
    'Hand Woven Wool/Hemp Dhurrie WHD-3597 — Natural, 3x4 m',
    'Hand Tufted Bamboo Silk Rug WHD-4499 — Colour of WHD-4908, 3.6x3.6 m',
    'שטיח צמר',
  ])('%s', (name) => expect(isRug({ name })).toBe(true))

  it('reads the category', () => expect(isRug({ name: 'WHD-1', category: 'Rugs' })).toBe(true))

  it.each(['ARMONIA 1,5 PL - GR', 'ROUND STOOL 35x50', 'Drugstore shelf'])('%s is not a rug', (name) =>
    expect(isRug({ name })).toBe(false))
})
