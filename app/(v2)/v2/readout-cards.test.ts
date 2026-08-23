import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
    expect(fn).toMatch(/local < 0\.09 \? local \/ 0\.09 : local < 0\.77 \? 1 : 1 - \(local - 0\.77\) \/ 0\.23/)
  })

  it('leaves with the scan the moment the mic opens', () => {
    // scanA snaps to 0 leaving idle, so the cards go with it rather than animating over somebody
    // who is talking.
    expect(fn).toMatch(/\) \* scanA/)
  })
})

describe('each card measures its own width', () => {
  it('from its own text, at both sizes', () => {
    expect(fn).toMatch(/cctx\.measureText\(c\[0\]\)\.width/)
    expect(fn).toMatch(/cctx\.measureText\(c\[1\]\)\.width/)
    expect(fn).toMatch(/Math\.max\(kw, vw\) \+ padX \* 2/)
  })
  it('one at each margin, the right one dropped', () => {
    expect(fn).toMatch(/i === 0 \? margin : CW - margin - cd\.w/)
    expect(fn).toMatch(/i === 1 \? CH \* CARD_DROP : 0/)
    expect(src).toMatch(/const CARD_DROP = 0\.055/)
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
    expect(src).toMatch(/\{readouts && <canvas ref=\{cardsRef\} className="v2-cards" aria-hidden \/>\}/)
  })
  it('and the caller asks only on mobile', () => {
    // The approved desktop composition carries the same figures as static tiles in the right-hand
    // column; a second animated copy over the robot would be the same numbers twice.
    expect(home).toMatch(/readouts=\{isMobile === true\}/)
  })
})
