import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const css = strip(read('./v2-tokens.css'))
const figures = strip(read('./figures.tsx'))
const sheet = strip(read('./sheet.tsx'))
const analytics = strip(read('./analytics/page.tsx'))

// THE HIGHLIGHTER IS A TILE TREATMENT. It is a 12px acid block behind a 32px numeral, which reads as
// a mark ON the number. Scaled up to sit under a 132px display figure it became 26px tall and the
// full width of the hero — a smear ACROSS the number rather than a highlight on it.
//
// Kept where it works, removed where it does not. Both halves are asserted, because the obvious next
// edit in either direction is wrong: putting it back on the hero, or deleting the class outright
// while tidying up after it.

describe('the highlighter stays on the tiles', () => {
  it('the sheet tile still marks a numeral that has something new in it', () => {
    expect(sheet).toContain('{t.value !== null && t.value > 0 && <em className="v2-marker" aria-hidden />}')
  })

  it('and the class and its token survive', () => {
    expect(css).toContain('--v2-marker: #dfff6b;')
    expect(css).toMatch(/\.v2 \.v2-marker \{[^}]*height: 12px/)
    expect(css).toContain('.v2 .v2-tnum { position: relative; display: inline-block; }')
  })
})

describe('and off the analytics hero', () => {
  it('the hero renders the number and nothing behind it', () => {
    expect(figures).toContain(`<p className="v2-figbig">{hero.value ?? '—'}</p>`)
    expect(figures).not.toContain('v2-marker')
    expect(figures).not.toContain('v2-fignum-wrap')
  })

  it('the hero-only rules are gone, not merely overridden', () => {
    expect(css).not.toContain('v2-marker[data-hero]')
    expect(css).not.toContain('.v2-fignum-wrap')
  })

  it('and nothing asks for one any more', () => {
    // `marked` was a prop on the hero and analytics was its only caller. Leaving the prop would be an
    // invitation to set it again.
    expect(figures).not.toMatch(/marked\?: boolean/)
    expect(analytics).not.toMatch(/^\s*marked:/m)
  })

  it('the gradient is still the one treatment the hero carries', () => {
    expect(css).toMatch(/\.v2 \.v2-figbig \{[^}]*background: var\(--v2-grad\)/)
  })
})
