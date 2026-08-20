import { describe, it, expect } from 'vitest'
import { ORDER_STAGES, isTerminalStage } from './stages'
import { STAGE_COLORS } from './stage-colors'

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const relLum = (hex: string) =>
  rgb(hex).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a: string, b: string) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const lightness = (hex: string) => {
  const [r, g, b] = rgb(hex).map((c) => c / 255)
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2
}

describe('Order board stage colours', () => {
  it('gives every stage a colour, so a new stage cannot ship colourless', () => {
    for (const s of ORDER_STAGES) expect(STAGE_COLORS[s], s).toBeDefined()
    expect(Object.keys(STAGE_COLORS).sort()).toEqual([...ORDER_STAGES].sort())
  })

  it('keeps every header label readable on its own band', () => {
    for (const s of ORDER_STAGES) {
      expect(contrast(STAGE_COLORS[s].text, STAGE_COLORS[s].bg), s).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('gives adjacent stages visibly different bars', () => {
    for (let i = 1; i < ORDER_STAGES.length; i++) {
      const a = STAGE_COLORS[ORDER_STAGES[i - 1]].bar, b = STAGE_COLORS[ORDER_STAGES[i]].bar
      const distance = rgb(a).reduce((acc, c, j) => acc + Math.abs(c - rgb(b)[j]), 0)
      expect(distance, `${ORDER_STAGES[i - 1]} → ${ORDER_STAGES[i]}`).toBeGreaterThan(30)
    }
  })

  // The point of the terminal stages is that they stop asking for attention. Enforced rather than
  // trusted: a later hand reaching for a louder "cancelled" red has to argue with this test first.
  it('keeps terminal stages paler than any live one', () => {
    const livePalest = Math.max(...ORDER_STAGES.filter((s) => !isTerminalStage(s)).map((s) => lightness(STAGE_COLORS[s].bar)))
    for (const s of ORDER_STAGES.filter(isTerminalStage)) {
      expect(lightness(STAGE_COLORS[s].bar), s).toBeGreaterThan(livePalest)
    }
  })
})
