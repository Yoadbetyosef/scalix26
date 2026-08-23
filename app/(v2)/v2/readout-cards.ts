// THE ACID READOUTS — the two cards, and where they sit.
//
// A module of its own, with NO IMPORTS, and that is load-bearing rather than tidy: the geometry is
// what a headless render has to draw to be checking the real thing, and a browser bundle of it must
// not drag React, next/* or the persona map in behind it. Same reason letterhead-styles.ts and
// product-types.ts are shaped this way.
//
// They never made it across when Rudi became a robot, and when they did come back they did not draw
// at all — see the note on the canvas element in rudi-canvas.tsx.

// Two cards, on their OWN clock against the scan's, so the pairs drift rather than arriving with it.
// They never made it across when Rudi became a robot; this is them, from rudi-scan-v26.
export const CARD_CYCLE_MS = 5250
export const CARDS: Array<Array<[string, string]>> = [
  [['CALLS TODAY', '3'], ['ANSWERED', '100%']],
  [['WAITING ON YOU', '1'], ['BOOKED', '1']],
  [['AFTER HOURS', '6'], ['AVG CALL', '1m 21s']],
]
/**
 * The fraction of height the readouts must not pass, so the copy underneath is never covered.
 *
 * 0.660 IS THE FALLBACK, NOT THE RULE. It was measured against one sentence at one width. On a real
 * phone the caption is whatever Rudi has to say, and a two-line sentence grows the block upward past
 * any fixed fraction — which is how CALLS TODAY ended up sitting on the copy. The ceiling is measured
 * off the element the cards have to clear; this is only what it falls back to when there is nothing
 * to measure.
 */
export const CEILING_FALLBACK = 0.66
/**
 * How far the right-hand card hangs below the left one, as a fraction of height.
 *
 * Shared by the drawing and the ceiling deliberately: the LOWER card is the one that has to clear the
 * copy, so a ceiling computed without it leaves exactly one of the two overlapping — the half-fixed
 * version of the bug, and harder to see than the whole one.
 */
export const CARD_DROP = 0.055
/** Clear air between the lowest card and the top of the block. */
export const CARD_GAP = 0.02

/** One card, placed. Pure, and exported so a render check draws the real geometry, not a copy. */
export interface CardBox { x: number; y: number; w: number; h: number; r: number; k: string; v: string; keyY: number; valY: number }

/** The alpha of the pair at this point in the cycle: in over 0.09, held 0.68, out over 0.23. */
export const cardAlpha = (ct: number, sets = CARDS.length): number => {
  const per = 1 / sets
  const local = (ct % per) / per
  return local < 0.09 ? local / 0.09 : local < 0.77 ? 1 : 1 - (local - 0.77) / 0.23
}

/**
 * Where the two cards sit, given the frame, the ceiling and a way to measure text.
 *
 * `measure` is injected so this stays pure: the canvas passes ctx.measureText, a test passes a stub,
 * and a headless render passes the browser's. Every number below is a fraction of the backing store.
 */
export function cardLayout(
  W: number, H: number, ceiling: number, a: number,
  set: Array<[string, string]>,
  measure: (text: string, font: string) => number,
): { boxes: CardBox[]; keyFont: string; valFont: string } {
  const keyFont = `500 ${W * 0.019}px "JetBrains Mono", ui-monospace, monospace`
  const valFont = `500 ${W * 0.068}px "Inter Tight", system-ui, sans-serif`
  const padX = W * 0.028, padY = H * 0.012, lead = H * 0.030
  const hh = padY * 2 + lead + W * 0.040
  const y = H * ceiling - hh
  const rise = (1 - a) * H * 0.012
  const margin = W * 0.056
  const boxes = set.map(([k, v], i) => {
    const w = Math.max(measure(k, keyFont), measure(v, valFont)) + padX * 2
    const top = y + rise + (i === 1 ? H * CARD_DROP : 0)
    return {
      x: i === 0 ? margin : W - margin - w, y: top, w, h: hh, r: W * 0.013,
      k, v, keyY: top + padY + W * 0.016, valY: top + padY + lead + W * 0.040,
    }
  })
  return { boxes, keyFont, valFont }
}

