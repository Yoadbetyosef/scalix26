import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./use-sheet-drag.ts', import.meta.url), 'utf8')
const sheet = readFileSync(new URL('./sheet.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./v2-tokens.css', import.meta.url), 'utf8')

// The sheet advertised SWIPE UP and opened on tap. These are the promises the gesture makes, written
// down — the numbers as much as the shape, because a threshold nobody can find is a threshold that
// gets "tidied" to something that feels wrong.

describe('the sheet responds to the gesture it advertises', () => {
  it('uses pointer events, so a trackpad drag behaves like a thumb', () => {
    for (const e of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      expect(src).toContain(`'${e}'`)
    }
    expect(src).not.toMatch(/touchstart|touchmove|touchend/)
  })

  it('brings no gesture library with it', () => {
    expect(src).not.toMatch(/from '(?!react)/)
  })

  it('follows the finger rather than jumping at the end', () => {
    // The transition is turned off for the duration and the transform is written every move.
    expect(src).toContain("el.style.transition = 'none'")
    expect(src).toContain('follow(dy)')
  })

  it('hands the transform back to CSS on release, so both rest states stay in one place', () => {
    expect(src).toContain("el.style.transition = ''")
    expect(src).toContain("el.style.transform = ''")
    expect(css).toContain('.v2-sheet[data-open="true"] { transform: translateY(0); }')
  })

  it('commits on velocity OR distance, and springs back otherwise', () => {
    expect(src).toContain('if (velocity > FLICK || travelled > height() * COMMIT) setOpen(!openRef.current)')
    expect(src).toMatch(/const FLICK = 0\.5/)
    expect(src).toMatch(/const COMMIT = 1 \/ 3/)
  })
})

describe('a drag mid-scroll belongs to the list', () => {
  it('only a drag that starts at the top may close the sheet', () => {
    // Otherwise the sheet closes every time somebody scrolls back up through the threads, which is
    // the most common thing they will do inside it.
    expect(src).toContain('const atTop = (scroller.current?.scrollTop ?? 0) <= 0')
    expect(src).toContain('if (!onHandle && !atTop) return')
  })

  it('the handle is always draggable, scrolled or not', () => {
    expect(src).toContain('const onHandle = !!handle.current && !!target && handle.current.contains(target)')
    // And the browser must not claim that drag first.
    // Written at (0,2,0). A bare `.v2-sh` is (0,1,0) and loses to globals.css's
    // `button:not(:disabled) { touch-action: manipulation }` at (0,1,1) — which is what made the
    // whole gesture inert, in both directions.
    expect(css).toContain('.v2 .v2-sh, .v2 .v2-grab { touch-action: none; }')
    expect(css).not.toMatch(/^\.v2-sh \{ touch-action/m)
  })

  it('the scroller is NOT given touch-action: none — the list must still scroll', () => {
    expect(css).not.toMatch(/\.v2-sin \{[^}]*touch-action: none/)
  })

  it('the hero owns its vertical drag too, or "swipe up anywhere" is not true', () => {
    expect(css).toContain('.v2 .v2-face { touch-action: none; }')
  })

  it('and only on a phone, where the gesture exists', () => {
    // The rules sit between the section's own heading and the media query that follows it. Slicing
    // to the first `}` would land inside the comment, which quotes a CSS rule.
    const block = css.slice(css.indexOf('THE SURFACES THAT OWN A VERTICAL DRAG'))
    const media = block.indexOf('@media (max-width: 719.98px)')
    expect(media).toBeGreaterThan(-1)
    expect(media).toBeLessThan(block.indexOf('.v2 .v2-sh, .v2 .v2-grab'))
  })
})

describe('the tap survives', () => {
  it('nothing is claimed until the drag passes the slop', () => {
    expect(src).toMatch(/const SLOP = 8/)
    expect(src).toContain('if (!dragging.current) {')
  })

  it('the sheet still opens and closes by tap, through the same setter', () => {
    expect(sheet).toContain('onClick={() => setOpen(true)}')
    expect(sheet).toContain("onClick={() => setOpen((v) => !v)}")
  })

  it('a drag that moved does not also fire as a tap underneath it', () => {
    expect(src).toContain("window.addEventListener('click', onClick, { capture: true })")
    expect(src).toContain('if (!moved.current) return')
  })

  it('a press that wanders the wrong way is given up rather than fought for', () => {
    expect(src).toContain('if (Math.abs(dy) > SLOP) from.current = null')
  })
})

describe('opening', () => {
  it('starts anywhere on the hero, and never inside the sheet', () => {
    expect(src).toContain('if (insideSheet) return')
  })

  it('drags the sheet up from its resting position rather than snapping it to the finger', () => {
    expect(src).toContain('translateY(calc(100% - ${Math.max(0, -dy)}px))')
  })
})

describe('the instrumentation is gone', () => {
  it('no console lines left behind', () => {
    expect(src).not.toContain('console.')
    expect(src).not.toMatch(/\[sheet\]/)
  })
})
