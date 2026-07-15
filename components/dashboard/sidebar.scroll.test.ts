import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Regression guard for the desktop sidebar scroll fix: the left sidebar must stay viewport-constrained
// with a single inner scroll region, so "Sign Out" is always reachable when the nav exceeds the viewport
// (short screens / high zoom / more modules added). The project has no DOM/RTL test tooling, so we assert
// the structural Tailwind classes at the source level (substring checks — robust to class reordering).
const src = readFileSync(new URL('./sidebar.tsx', import.meta.url), 'utf8')
const aside = src.slice(src.indexOf('<aside'), src.indexOf('</aside>'))

describe('desktop sidebar scrolling', () => {
  it('constrains the aside to the viewport height and hides overflow', () => {
    expect(aside).toMatch(/<aside[^>]*\bh-screen\b/)
    expect(aside).toMatch(/<aside[^>]*\boverflow-hidden\b/)
    expect(aside).toMatch(/<aside[^>]*\bflex-col\b/)
  })

  it('keeps the header/business section fixed (flex-shrink-0)', () => {
    // The logo/business header inside the aside must not shrink or scroll away.
    expect(aside).toMatch(/border-b border-hairline/)
    expect(aside.slice(0, aside.indexOf('overflow-y-auto'))).toContain('flex-shrink-0')
  })

  it('has exactly one inner vertical scroll region (flex-1 min-h-0 overflow-y-auto)', () => {
    // Match the full class combo (present only in the className, not in prose) so exactly one scroll
    // region exists — not nested or duplicated.
    expect(aside.match(/flex-1 min-h-0 overflow-y-auto/g)?.length).toBe(1)
  })

  it('keeps Sign Out inside the scrollable region so it is always reachable', () => {
    const scroll = aside.slice(aside.indexOf('overflow-y-auto'))
    expect(scroll).toContain('Sign Out')
    expect(scroll).toContain('handleSignOut')
  })

  it('does not introduce horizontal scrolling on the sidebar', () => {
    expect(aside).not.toMatch(/overflow-x-auto|overflow-x-scroll/)
  })
})
