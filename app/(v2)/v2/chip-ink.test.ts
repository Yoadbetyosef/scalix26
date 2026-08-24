import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// §33 — the two chips and the filled pill clear 4.5:1, and the way they do it must not drift back.
//
// The contrast itself is measured on the rendered pages, not here: 142 chips across eleven routes,
// worst 5.34:1. What a source test CAN hold is the construction, which is the part somebody would
// undo by accident.

const css = readFileSync(join(process.cwd(), 'app/(v2)/v2/v2-tokens.css'), 'utf8')

// A tiny oklab implementation, so the LIGHTNESS CONSTANTS are checked against the contrast they
// actually buy rather than trusted as magic numbers.
const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
const unlin = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)
const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const tint = (c: number[]) => c.map((v) => Math.round(v * 0.12 + 255 * 0.88))
function toOklab([r, g, b]: number[]) {
  const R = lin(r), G = lin(g), B = lin(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]
}
function fromOklab([L, a, b]: number[]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
    .map((v) => Math.max(0, Math.min(255, Math.round(unlin(v) * 255))))
}
const atL = (c: number[], L: number) => { const [, a, b] = toOklab(c); return fromOklab([L, a, b]) }

/** Every hue the app passes as --ghue or --chan: the four tints, red, live, mute, and all 13 stages. */
const HUES: Record<string, string> = {
  t1: '#ff2e93', t2: '#b843c4', t3: '#8b5cf6', t4: '#22d3ee',
  red: '#ff5c6c', live: '#b8ff29', mute: '#63636b',
  new: '#4E455B', waiting_factory_approval: '#6F69AB', factory_changes_requested: '#364891',
  factory_approved: '#A27AAE', waiting_customer_approval: '#974E93', customer_changes_requested: '#8D346D',
  customer_approved: '#B0788B', production: '#A14F55', ready: '#985F3E', delivered: '#B69B54',
  completed: '#B8B1C3', finished: '#D3CEC5', cancelled: '#A4ADB7',
}
const num = (name: string) => Number(css.match(new RegExp(`--${name}:\\s*([\\d.]+);`))![1])

describe('§33 — the chip ink clears AA', () => {
  it('deepens the ink by LIGHTNESS, keeping chroma and hue', () => {
    // `c h` is the whole point: mixing toward black instead needs one ratio for every hue, and the
    // ratio cyan needs turns the pink into a maroon.
    expect(css).toMatch(/\.v2-act \{ color: oklch\(from var\(--ghue[^)]*\)+ var\(--v2-ink-l\) c h\); \}/)
    expect(css).toMatch(/\.v2-stat \{ color: oklch\(from var\(--chan[^)]*\)+ var\(--v2-ink-l\) c h\); \}/)
    expect(css).toMatch(/\.v2-act\[data-solid\] \{ background: oklch\(from var\(--ghue[^)]*\)+ var\(--v2-solid-l\) c h\); \}/)
  })

  it('sets --v2-ink-l deep enough for every hue in use', () => {
    const L = num('v2-ink-l')
    for (const [name, h] of Object.entries(HUES)) {
      const c = hex(h)
      expect(ratio(atL(c, L), tint(c)), `${name} ink on its own 12% tint`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('sets --v2-solid-l deep enough for white on every hue in use', () => {
    const L = num('v2-solid-l')
    for (const [name, h] of Object.entries(HUES)) {
      expect(ratio([255, 255, 255], atL(hex(h), L)), `white on ${name}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('leaves a fallback that is no worse than what shipped before', () => {
    // Outside the @supports block both still declare the plain hue, so an engine without relative
    // colour syntax renders exactly today's appearance rather than nothing.
    const before = css.slice(0, css.indexOf('@supports (color: oklch(from red'))
    expect(before).toMatch(/\.v2-act \{[\s\S]*?color: var\(--ghue, var\(--v2-t1\)\);/)
    expect(before).toMatch(/\.v2-stat \{[\s\S]*?color: var\(--chan, var\(--v2-t1\)\);/)
  })

  it('keeps a row\'s sub-line rule off the chips inside it', () => {
    // `.v2-row .v2-m span` is (0,3,1) and reached every chip in the title line, which is (0,1,0):
    // the background was the right hue and the label was a 2.7:1 grey. Direct child only.
    expect(css).toMatch(/\.v2 \.v2-row \.v2-m > span \{/)
    expect(css).not.toMatch(/\.v2 \.v2-row \.v2-m span \{/)
    expect(css).not.toMatch(/\.v2 \.v2-pbody \.v2-row \.v2-m span \{/)
  })

  it('gives a colourless chip a solid ink, because a translucent one cannot be deepened', () => {
    // --v2-ink-45 was doing this job at 2.74:1; setting the lightness of a 45%-alpha colour still
    // leaves 45% alpha.
    expect(css).toMatch(/--v2-mute: #63636b;/)
    const c = hex('#63636b')
    expect(ratio(c, tint(c))).toBeGreaterThanOrEqual(4.5)
  })
})
