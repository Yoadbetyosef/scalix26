import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Regression guard for the desktop sidebar scroll fix: the left sidebar must stay viewport-constrained
// with a single inner scroll region, so "Sign Out" is always reachable when the nav exceeds the viewport
// (short screens / high zoom / more modules added). The project has no DOM/RTL test tooling, so we assert
// the structural Tailwind classes at the source level (substring checks — robust to class reordering).
const src = readFileSync(new URL('./sidebar.tsx', import.meta.url), 'utf8')
const aside = src.slice(src.indexOf('<aside'), src.indexOf('</aside>'))

describe('desktop sidebar scrolling', () => {
  // The guarantee is unchanged and the mechanism is not: the rail is /v2's now, so the scroll region
  // is `.v2-rail`, whose overflow-y:auto lives in v2-tokens.css rather than in a Tailwind class. What
  // still has to be true is what always had to be true — the aside cannot exceed the viewport, there
  // is exactly one scrolling region inside it, and Sign Out is inside that region so it is reachable
  // on a short screen or at high zoom.
  const css = readFileSync(new URL('../../app/(v2)/v2/v2-tokens.css', import.meta.url), 'utf8')

  it('constrains the aside to the viewport height', () => {
    expect(aside).toMatch(/<aside[^>]*\bh-screen\b/)
    // `.v2` carries height:100dvh and overflow:hidden — the aside cannot grow past the viewport.
    expect(aside).toMatch(/<aside[^>]*className="v2 /)
    expect(css).toMatch(/\.v2 \{[^}]*overflow: hidden/)
  })

  it('has exactly one inner vertical scroll region, and it is the rail', () => {
    expect(aside.match(/className="v2-rail"/g)?.length).toBe(1)
    expect(css).toMatch(/\.v2-rail \{[^}]*overflow-y: auto/)
    // No second scroller nested inside it.
    expect(aside).not.toMatch(/overflow-y-auto/)
  })

  it('keeps Sign Out inside the scrolling region so it is always reachable', () => {
    const rail = aside.slice(aside.indexOf('className="v2-rail"'))
    expect(rail).toContain('Sign Out')
    expect(rail).toContain('handleSignOut')
  })

  it('pins Sign Out to the bottom rather than letting it float mid-list', () => {
    expect(aside).toMatch(/mt-auto/)
  })

  it('does not introduce horizontal scrolling on the sidebar', () => {
    expect(aside).not.toMatch(/overflow-x-auto|overflow-x-scroll/)
  })
})
