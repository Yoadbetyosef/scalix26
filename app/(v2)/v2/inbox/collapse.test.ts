import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { nextCollapsed, COLLAPSE_AT, EXPAND_AT } from './collapse'

// The reported failure, written down: a thumb resting near the trigger flipped the state every
// frame, and each flip restarted a half-second height animation that the next flip reversed.

describe('nextCollapsed', () => {
  it('collapses only past 64, and expands only below 24', () => {
    expect(COLLAPSE_AT).toBe(64)
    expect(EXPAND_AT).toBe(24)
    expect(nextCollapsed(false, 65)).toBe(true)
    expect(nextCollapsed(true, 23)).toBe(false)
  })

  it('holds whatever it is between the two lines', () => {
    for (const y of [24, 40, 55, 64]) {
      expect(nextCollapsed(false, y)).toBe(false)   // not collapsed yet, and 64 does not do it
      expect(nextCollapsed(true, y)).toBe(true)     // already collapsed, and it stays
    }
  })

  it('does not flip while a thumb jitters on the boundary', () => {
    // Sub-pixel deltas either side of the old single line. One threshold flipped on every one of
    // these; two thresholds answer the same thing for all of them.
    let state = true
    for (const y of [63.4, 64.1, 63.9, 64.6, 62.8, 65.2, 64.0]) {
      const next = nextCollapsed(state, y)
      expect(next).toBe(state)
      state = next
    }
  })

  it('is a function of the state it is given, not of history', () => {
    // Same offset, two answers — which is the definition of hysteresis and the reason a single
    // `scrollTop > n` could never hold.
    expect(nextCollapsed(false, 40)).toBe(false)
    expect(nextCollapsed(true, 40)).toBe(true)
  })

  it('survives the top of the list and a rubber-banded negative offset', () => {
    expect(nextCollapsed(true, 0)).toBe(false)
    expect(nextCollapsed(true, -30)).toBe(false)
    expect(nextCollapsed(false, -30)).toBe(false)
  })
})

describe('the handler that uses it', () => {
  const code = readFileSync(new URL('./groups.tsx', import.meta.url), 'utf8')

  it('coalesces to one write per frame', () => {
    // The rAF handle is always a positive integer, so a pending frame makes every further scroll
    // event a no-op until it runs. This was already true — it was not the cause of the flicker — and
    // it is asserted so it stays true.
    expect(code).toContain('if (raf) return')
    expect(code).toContain('raf = requestAnimationFrame(')
  })

  it('writes only when the answer changes', () => {
    expect(code).toContain('if (next === collapsed) return')
  })

  it('keeps the state beside the node, not in React', () => {
    // A thumb moving must not re-render the inbox.
    expect(code).toContain('let collapsed = false')
    expect(code).not.toMatch(/setCollapsed|useState\(false\)/)
  })
})
