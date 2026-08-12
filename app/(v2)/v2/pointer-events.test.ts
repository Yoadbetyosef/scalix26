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
    // Without this the rail and the right column would be inert.
    expect(css).toMatch(/\.v2 \.v2-rail, \.v2 \.v2-side \{ pointer-events: auto; \}/)
    expect(css).toMatch(/\.v2 \.v2-mobile > \* \{ pointer-events: auto; \}/)
  })

  it('the collapsed dashboard is NOT in that list', () => {
    // It is a full-bleed panel at z-index 4 over the hero. Opting it in unconditionally put it on top
    // of the Talk button and of every mousemove — the click died and the cursor ring vanished with it.
    expect(css).not.toMatch(/\.v2-rail, \.v2 \.v2-side, \.v2 \.v2-dash/)
  })

  it('and it leaves the stack entirely when the hero is expanded', () => {
    // opacity alone is not enough: an opacity-0 panel is still hit-tested and still focusable.
    expect(rule('.v2-dash')).toMatch(/visibility:\s*hidden/)
    expect(rule('.v2-dash')).toMatch(/pointer-events:\s*none/)
    expect(css).toMatch(/\.v2-root\[data-min\] \.v2-dash \{[\s\S]*?visibility: visible/)
  })

  it('the phone gets the overlay measured for a phone', () => {
    // One overlay and one composer for both layouts since the hoist — two composers were what made
    // the button ref ambiguous, so this is a rule and not a second component.
    expect(css).toMatch(/@media \(max-width: 719\.98px\) \{[\s\S]*?\.v2 \.v2-overlay \{/)
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
