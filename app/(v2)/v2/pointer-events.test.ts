import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Since the hoist the chrome is a SIBLING painted above the hero, not a parent wrapping it. That makes
// pointer-events a correctness concern rather than a detail: anything covering her that does not opt
// out swallows the Talk button and every mousemove the custom cursor reads e.target from.
//
// Marking only the centre cell transparent is NOT enough — a transparent child makes the hit fall
// through to its PARENT, which is the chrome container itself. That is the bug this pins.

const css = readFileSync(join(process.cwd(), 'app/(v2)/v2/v2-tokens.css'), 'utf8')
const ui = readFileSync(join(process.cwd(), 'app/(v2)/v2/interactions.tsx'), 'utf8')

const rule = (selector: string) => {
  const i = css.indexOf(selector + ' {')
  return i === -1 ? '' : css.slice(i, css.indexOf('}', i))
}

describe('the chrome cannot swallow the hero', () => {
  it('the desktop container is transparent to the pointer', () => {
    expect(rule('.v2-app')).toMatch(/pointer-events:\s*none/)
  })

  it('the mobile container is too', () => {
    expect(rule('.v2 .v2-mobile')).toMatch(/pointer-events:\s*none/)
  })

  it('the regions that ARE interactive opt back in', () => {
    // Without this the rail, the right column and the collapsed dashboard would all be inert.
    expect(css).toMatch(/\.v2 \.v2-rail, \.v2 \.v2-side, \.v2 \.v2-dash \{ pointer-events: auto; \}/)
    expect(css).toMatch(/\.v2 \.v2-mobile > \* \{ pointer-events: auto; \}/)
  })

  it('the stage stays transparent — she is behind it', () => {
    expect(rule('.v2-stage')).toMatch(/pointer-events:\s*none/)
  })
})

describe('the custom cursor depends on reaching the canvas', () => {
  it('it reads e.target and shows only over the CANVAS', () => {
    // This is why the pointer-events rule above is not cosmetic: with the chrome capturing, e.target
    // was never the canvas and the ring simply stopped appearing.
    expect(ui).toMatch(/setOver\(!!t && t\.tagName === 'CANVAS'\)/)
  })
})
