import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'app/(v2)/v2/v2-tokens.css'), 'utf8')

// §35 — the media and code block. The photo and the QR are one component, not two
// boxes that happen to be near each other, and the frame must survive a product
// with no image.
describe('.v2-shots — media and code', () => {
  it('gives the photo and the code the same frame', () => {
    // One rule for both, so they cannot drift into two sizes or two radii.
    expect(css).toMatch(/\.v2-shot > img, \.v2-shot > i \{/)
    const rule = css.slice(css.indexOf('.v2-shot > img, .v2-shot > i {'))
      .slice(0, css.slice(css.indexOf('.v2-shot > img, .v2-shot > i {')).indexOf('}'))
    expect(rule).toContain('border-radius: var(--v2-radius-card)')
    expect(rule).toContain('border: 1px solid var(--v2-line)')
  })

  it('sizes from --shot so one component serves a detail block and a row thumbnail', () => {
    expect(css).toContain('width: var(--shot, 112px); height: var(--shot, 112px)')
  })

  it('keeps a quiet zone and white under the code', () => {
    // A QR is edge-to-edge modules; the hairline reads as part of the code without it.
    expect(css).toMatch(/\.v2-shot\[data-code\] > img \{[^}]*padding: 7px/)
    expect(css).toMatch(/\.v2-shot\[data-code\] > img \{[^}]*background: #fff/)
  })

  it('draws the empty-image fallback in a colour that exists', () => {
    // --v2-ink-24 is referenced 23 times in this file and defined nowhere, so
    // `stroke` fell back to its initial `none` and the icon was invisible. §35.
    expect(css).toMatch(/\.v2-shot > i svg \{[^}]*stroke: var\(--v2-ink-45\)/)
    expect(css).not.toMatch(/\.v2-shot > i svg \{[^}]*--v2-ink-24/)
  })

  it('still has no definition for --v2-ink-24, so this test fails when someone adds one', () => {
    // Not a defect to fix silently: defining it lightens 23 places at once, several
    // of them mono micro-labels that would land near 2:1. When it is defined, the
    // contrast of every one of those sites has to be checked — that is what this
    // failure is for.
    // Anchored to a declaration, so the prose above that names the token does not count.
    expect(css).not.toMatch(/[\n;{]\s*--v2-ink-24\s*:/)
  })
})
