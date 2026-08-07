import { describe, it, expect } from 'vitest'

// The ladder floor, extracted as arithmetic so it can be tested without a database.
//
// This exists because of one call. A caller asked Your Design Collective for a "RAJA sofa"; the tenant
// holds eight RAJA products including RAJA 2,5 PL — the 2.5-seater they wanted — and the agent said
// "I'm not seeing it in the system at the moment."
//
// Tokens are ANDed, so "raja sofa" required one product matching BOTH words. No RAJA product contains
// "sofa". Searching "raja" alone matches eight. The ladder could have dropped a word and did not.
const floorOld = (n: number) => Math.max(Math.min(2, n), n - 1)
const floorNew = (n: number) => Math.max(1, n - 1)
const rungs = (n: number, floor: (n: number) => number) => {
  const out: number[] = []
  for (let keep = n; keep >= floor(n); keep--) out.push(keep)
  return out
}

describe('the ladder floor', () => {
  it('let a two-token query run only one rung — the bug', () => {
    expect(rungs(2, floorOld)).toEqual([2])          // "raja sofa" and nothing else
    expect(rungs(2, floorNew)).toEqual([2, 1])       // ...then "raja", which matches eight
  })

  it('changes nothing at any other width', () => {
    // The fix is the stated intent — full phrase, then minus its least distinctive word — and it must
    // not quietly buy recall at three and four tokens by spending another round trip there.
    for (const n of [1, 3, 4, 5, 6]) {
      expect(rungs(n, floorNew)).toEqual(rungs(n, floorOld))
    }
  })

  it('never asks for fewer than one token', () => {
    expect(floorNew(1)).toBe(1)
    expect(rungs(1, floorNew)).toEqual([1])
  })

  it('always tries the full phrase first, at every width', () => {
    // A narrower answer must never pre-empt an exact one.
    for (let n = 1; n <= 6; n++) expect(rungs(n, floorNew)[0]).toBe(n)
  })

  it('never runs more than two rungs, at any width', () => {
    // Every rung is a round trip on a live call with a 250ms budget.
    for (let n = 1; n <= 6; n++) expect(rungs(n, floorNew).length).toBeLessThanOrEqual(2)
  })
})
