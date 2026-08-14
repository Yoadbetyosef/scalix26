import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { channelKey, CHANNEL_LABEL } from '../channels'

const css = readFileSync(new URL('../v2-tokens.css', import.meta.url), 'utf8')
const glyphs = readFileSync(new URL('./glyphs.tsx', import.meta.url), 'utf8')

// L1: every channel gets its own glyph and its own hue, so a column of rows sorts by eye. What was
// actually missing was a BRANCH — voice had no glyph and fell through to a speech bubble that is a
// near-twin of the SMS one, so a call, a text and an unrecognised channel all drew the same mark.

const table = css.slice(css.indexOf('THREE VALUES PER CHANNEL'), css.indexOf('THE MARK HAS TO READ'))

describe('one table, three columns', () => {
  it.each([
    ['voice', '#8B5CF6', 'rgba(139, 92, 246, 0.1)', '#8B5CF6'],
    ['sms', '#22D3EE', 'rgba(34, 211, 238, 0.1)', '#0E9BB5'],
    ['instagram', '#E1306C', 'rgba(225, 48, 108, 0.1)', '#E1306C'],
    ['facebook', '#1877F2', 'rgba(24, 119, 242, 0.1)', '#1877F2'],
    ['email', '#F5A524', 'rgba(245, 165, 36, 0.1)', '#B87A0C'],
  ])('%s carries its hue, its wash and its ink', (key, hue, wash, ink) => {
    const row = table.split('\n').find((l) => l.includes(`[data-channel="${key}"]`))
    expect(row).toBeDefined()
    expect(row).toContain(`--chan: ${hue}`)
    expect(row).toContain(`--chan-wash: ${wash}`)
    expect(row).toContain(`--chan-ink: ${ink}`)
  })

  it('the wash is the hue at 10%, not a separate colour', () => {
    // A wash that drifts from its own hue is two colours pretending to be one.
    for (const [hue, wash] of [
      ['#8B5CF6', 'rgba(139, 92, 246'], ['#22D3EE', 'rgba(34, 211, 238'],
      ['#E1306C', 'rgba(225, 48, 108'], ['#1877F2', 'rgba(24, 119, 242'],
      ['#F5A524', 'rgba(245, 165, 36'],
    ]) {
      const rgb = [1, 3, 5].map((i) => parseInt(hue.slice(i, i + 2), 16))
      expect(wash).toBe(`rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}`)
    }
  })

  it('there is no second table anywhere in /v2', () => {
    // Every mark reads --chan. A component that wrote its own hex would be the thread and its row
    // disagreeing about what channel they are.
    expect(glyphs).not.toMatch(/#[0-9A-Fa-f]{6}/)
    expect((css.match(/\[data-channel="voice"\]/g) ?? []).length).toBe(1)
  })
})

describe('every channel has a glyph of its own', () => {
  it.each(['voice', 'sms', 'instagram', 'facebook', 'email', 'web'])('%s', (key) => {
    expect(glyphs).toContain(`channel === '${key}'`)
  })

  it('a call is a phone, not a speech bubble', () => {
    // The specific miss: voice had no branch at all.
    expect(glyphs).toContain('const Voice = ()')
    const branch = glyphs.slice(glyphs.indexOf('{channel ==='))
    expect(branch.indexOf("'voice' ? <Voice />")).toBeGreaterThan(-1)
  })

  it('an unknown channel gets the neutral mark and no colour', () => {
    // A guessed hue makes an unrecognised channel look like one of the six.
    expect(glyphs).toContain(': <Unknown />')
    // The neutral fallback lives with the tile's own rule, not in the component: the fallbacks on the
    // two custom properties ARE the "no entry" case.
    expect(css).toContain('background: var(--chan-wash, var(--v2-hover)); color: var(--chan, var(--v2-ink-55))')
  })
})

describe('the map the marks are keyed by', () => {
  it('maps what the rows actually carry', () => {
    expect(channelKey('voice')).toBe('voice')
    expect(channelKey('phone')).toBe('voice')
    expect(channelKey('whatsapp')).toBe('sms')
    expect(channelKey('messenger')).toBe('facebook')
  })

  it('leaves an unknown channel unmarked rather than guessing', () => {
    expect(channelKey('carrier-pigeon')).toBeNull()
    expect(channelKey(null)).toBeNull()
  })

  it('every key it can return has a label and a table row', () => {
    for (const key of Object.keys(CHANNEL_LABEL)) {
      expect(table).toContain(`[data-channel="${key}"]`)
    }
  })
})
