import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardAlpha, cardLayout } from './readout-cards'

// Measuring text needs a canvas. A stub of a fixed width per character is enough to assert placement,
// which is what these are about — the real widths come from the browser and are checked by eye.
const measure = (t: string, font: string) => t.length * (font.includes('Mono') ? 6 : 20)

// The two acid cards from rudi-scan-v26. They never made it across when Rudi became a robot.

const src = readFileSync(join(process.cwd(), 'app/(v2)/v2/rudi-canvas.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const home = readFileSync(join(process.cwd(), 'app/(v2)/v2/home-client.tsx'), 'utf8')
const css = readFileSync(join(process.cwd(), 'app/(v2)/v2/v2-tokens.css'), 'utf8')
const fn = src.slice(src.indexOf('function drawCards'), src.indexOf('function draw(now: number)'))

describe('three pairs, on their own clock', () => {
  it('rotates the three the reference names', () => {
    expect(src).toMatch(/\['CALLS TODAY', '3'\], \['ANSWERED', '100%'\]/)
    expect(src).toMatch(/\['WAITING ON YOU', '1'\], \['BOOKED', '1'\]/)
    expect(src).toMatch(/\['AFTER HOURS', '6'\], \['AVG CALL', '1m 21s'\]/)
  })

  it('runs at 5.25s against the scan, not with it', () => {
    expect(src).toMatch(/const CARD_CYCLE_MS = 5250/)
    expect(fn).toMatch(/ct \+ dt \/ \(CARD_CYCLE_MS \/ 1000\)/)
  })

  it('fades in over 0.09, holds 0.68, leaves over 0.23', () => {
    // Asserted through the function rather than through its source, now that there is one.
    expect(cardAlpha(0)).toBeCloseTo(0, 6)
    expect(cardAlpha(1 / 3 * 0.045)).toBeCloseTo(0.5, 6)   // half way in
    expect(cardAlpha(1 / 3 * 0.09)).toBeCloseTo(1, 6)      // fully in
    expect(cardAlpha(1 / 3 * 0.5)).toBe(1)                 // held
    expect(cardAlpha(1 / 3 * 0.77)).toBeCloseTo(1, 6)      // last frame of the hold
    expect(cardAlpha(1 / 3 * 0.885)).toBeCloseTo(0.5, 6)   // half way out
    expect(cardAlpha(1 / 3 * 0.9999)).toBeLessThan(0.01)
  })

  it('leaves with the scan the moment the mic opens', () => {
    // scanA snaps to 0 leaving idle, so the cards go with it rather than animating over somebody
    // who is talking.
    expect(fn).toMatch(/\) \* scanA/)
  })
})

describe('each card measures its own width', () => {
  it('from its own text, at both sizes — the wider of the two decides', () => {
    const W = 780, H = 1688
    const short = cardLayout(W, H, 0.66, 1, [['A', '1'], ['B', '2']], measure)
    const long = cardLayout(W, H, 0.66, 1, [['WAITING ON YOU', '1'], ['B', '2']], measure)
    expect(long.boxes[0].w).toBeGreaterThan(short.boxes[0].w)
    // The VALUE can be the wider one too: "1m 21s" at 68px beats "AVG CALL" at 19px.
    const byValue = cardLayout(W, H, 0.66, 1, [['A', '1m 21s'], ['B', '2']], measure)
    expect(byValue.boxes[0].w).toBeGreaterThan(short.boxes[0].w)
  })

  it('one at each margin, the right one dropped', () => {
    const W = 780, H = 1688
    const { boxes } = cardLayout(W, H, 0.66, 1, [['CALLS TODAY', '3'], ['ANSWERED', '100%']], measure)
    expect(boxes[0].x).toBeCloseTo(W * 0.056, 6)                 // left margin
    expect(boxes[1].x + boxes[1].w).toBeCloseTo(W - W * 0.056, 6) // right margin
    expect(boxes[1].y - boxes[0].y).toBeCloseTo(H * 0.055, 6)     // the drop
    expect(src).toMatch(/const CARD_DROP = 0\.055/)
  })

  it('hangs the pair off the ceiling, and the LOWER one is the one that clears it', () => {
    const W = 780, H = 1688, ceiling = 0.5
    const { boxes } = cardLayout(W, H, ceiling, 1, [['A', '1'], ['B', '2']], measure)
    expect(boxes[0].y + boxes[0].h).toBeCloseTo(H * ceiling, 6)
    expect(boxes[1].y + boxes[1].h).toBeGreaterThan(H * ceiling)  // which is why the ceiling subtracts the drop
  })
})

describe('the ceiling is measured, not guessed', () => {
  it('off the block the cards have to clear', () => {
    const m = src.slice(src.indexOf('function measureCeiling'), src.indexOf('function fit()'))
    expect(m).toMatch(/querySelector\('\[data-bottom-block\]'\)/)
    expect(home).toMatch(/className="v2-overlay" data-bottom-block/)
  })

  it('accounts for the DROP, or exactly one of the two overlaps', () => {
    const m = src.slice(src.indexOf('function measureCeiling'), src.indexOf('function fit()'))
    expect(m).toMatch(/- CARD_DROP - CARD_GAP/)
  })

  it('falls back only when there is nothing to measure', () => {
    expect(src).toMatch(/const CEILING_FALLBACK = 0\.66/)
    const m = src.slice(src.indexOf('function measureCeiling'), src.indexOf('function fit()'))
    expect(m).toMatch(/if \(!block\) \{ ceiling = CEILING_FALLBACK; return \}/)
    // Never above the top third — cards by his dome is worse than no cards.
    expect(m).toMatch(/Math\.max\(0\.30, Math\.min\(CEILING_FALLBACK, want\)\)/)
  })

  it('is a layout read on layout, never per frame', () => {
    expect(src).not.toMatch(/function draw\(now: number\)[\s\S]{0,4000}measureCeiling\(\)/)
    expect(src).toMatch(/const ro = new ResizeObserver\(\(\) => \{\s*\n\s*fit\(\)\s*\n\s*measureCeiling\(\)/)
  })
})

describe('they sit above the scrim, on their own canvas', () => {
  it('because on the scan\'s the gradient dims the lower one', () => {
    expect(src).toMatch(/const cardsCanvas = cardsRef\.current/)
    expect(src).toMatch(/cardsCanvas\.width = CW; cardsCanvas\.height = CH/)
    expect(css).toMatch(/\.v2 \.v2-cards \{[^}]*z-index: 3/)
    expect(css).toMatch(/\.v2-scrim \{[^}]*z-index: 2/)
  })
  it('and go entirely when the hero collapses to a thumbnail', () => {
    expect(css).toMatch(/\.v2 \.v2-root\[data-min\] \.v2-cards \{ display: none; \}/)
    expect(src).toMatch(/if \(cctx\) cctx\.clearRect\(0, 0, CW, CH\)/)
  })
})

describe('mobile only, and decided rather than defaulted', () => {
  it('is off unless the caller asks', () => {
    expect(src).toMatch(/readouts = false/)
  })

  it('MOUNTS THE CANVAS ALWAYS, and gates only the drawing — the bug that hid them', () => {
    // `{readouts && <canvas …/>}` is false on the first render, because useIsMobile resolves to null
    // before it resolves to true. The loop's effect captures cardsRef.current once, at mount, so it
    // captured null; the element appeared a tick later and nothing looked again. The cards never drew
    // on any device. The element is unconditional now and the PROP is read through a live ref.
    expect(src).not.toMatch(/\{readouts && <canvas/)
    expect(src).toMatch(/<canvas ref=\{cardsRef\} className="v2-cards" aria-hidden \/>/)
    expect(src).toMatch(/const readoutsRef = useRef\(readouts\)/)
    expect(src).toMatch(/useEffect\(\(\) => \{ readoutsRef\.current = readouts \}, \[readouts\]\)/)
    expect(src).toMatch(/if \(!readoutsRef\.current\) \{ cctx\.clearRect\(0, 0, CW, CH\); return \}/)
  })
  it('and the caller asks only on mobile', () => {
    // The approved desktop composition carries the same figures as static tiles in the right-hand
    // column; a second animated copy over the robot would be the same numbers twice.
    expect(home).toMatch(/readouts=\{isMobile === true\}/)
  })
})
