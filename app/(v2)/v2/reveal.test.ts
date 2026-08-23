import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReveal, revealStepMs, type RevealHost } from './reveal'

// The agent sends no partial recognition: one message lands ~700ms after the endpoint carrying the
// whole sentence. So the reveal is presentation, and these are the two things about it that matter —
// the words step, and her turn is HELD until the last one.
//
// ── WHAT THESE TESTS DO NOT PROVE ───────────────────────────────────────────────────────────────────
//
// That anything renders. The sequencer is driven here through a stub host, so every assertion below
// is about the ORDER and TIMING of calls, never about a screen. Specifically, none of this shows:
//
//   · that `show()` reaching setSaid puts the words in the caption, or that the caption re-renders
//     at all — React is not involved in this file
//   · that the veil stays raised and the button still reads End for the length of the reveal, which
//     is the visible consequence of holding the arm
//   · that 45ms per word looks like anything in particular, or that the cap reads as natural
//   · that the real host wiring in home-client is correct — that it passes setSaid and rudi.arm and
//     a live reduced-motion query, rather than three plausible stubs
//
// A component test with jsdom would cover the first two. That is a direction for the repo rather
// than a fix for one animation, so it was left as a decision to take on its own merits. Until it is
// taken, the reveal is proved as a sequence and unproved as a picture.

describe('how long one word waits', () => {
  it('is 45ms while the sentence is short enough to afford it', () => {
    for (const n of [1, 2, 5, 10, 15]) expect(revealStepMs(n)).toBe(45)
  })

  it('compresses once 45ms each would break the ceiling', () => {
    expect(revealStepMs(16)).toBeCloseTo(43.75, 5)
    expect(revealStepMs(40)).toBeCloseTo(17.5, 5)
    for (const n of [16, 20, 40, 200]) expect(revealStepMs(n) * n).toBeLessThanOrEqual(700 + 1e-9)
  })

  it('does not divide by zero on an empty sentence', () => {
    expect(revealStepMs(0)).toBe(45)
  })
})

describe('a turn, driven end to end', () => {
  let shown: string[]
  let arms: number
  let reduced: boolean
  let host: RevealHost

  beforeEach(() => {
    vi.useFakeTimers()
    shown = []
    arms = 0
    reduced = false
    host = { show: (t) => shown.push(t), arm: () => { arms++ }, reduced: () => reduced }
  })
  afterEach(() => vi.useRealTimers())

  const SENTENCE = 'One thing needs you'

  it('lands one word at a time, in order, at 45ms', () => {
    const r = createReveal(host)
    r.say(SENTENCE)
    expect(shown).toEqual(['One'])

    vi.advanceTimersByTime(44)
    expect(shown).toEqual(['One'])          // not a word early
    vi.advanceTimersByTime(1)
    expect(shown).toEqual(['One', 'One thing'])

    vi.advanceTimersByTime(90)
    expect(shown).toEqual(['One', 'One thing', 'One thing needs', 'One thing needs you'])
    expect(r.running).toBe(false)
  })

  it('HOLDS the arm rather than delaying the moment, and fires it on the last word', () => {
    const r = createReveal(host)
    r.say(SENTENCE)
    r.arm()                                  // arrives in the same emit as `said`, mid-reveal
    expect(arms).toBe(0)

    vi.advanceTimersByTime(90)               // words two and three
    expect(arms).toBe(0)                     // still her turn to wait
    vi.advanceTimersByTime(45)               // the last word
    expect(shown.at(-1)).toBe(SENTENCE)
    expect(arms).toBe(1)
  })

  it('arms immediately when no sentence is landing', () => {
    const r = createReveal(host)
    r.arm()
    expect(arms).toBe(1)
  })

  it('arms exactly once, not once per remaining word', () => {
    const r = createReveal(host)
    r.say(SENTENCE)
    r.arm()
    vi.advanceTimersByTime(5000)
    expect(arms).toBe(1)
  })

  it('abandons the sentence when she answers, showing all of it at once', () => {
    const r = createReveal(host)
    r.say(SENTENCE)
    vi.advanceTimersByTime(45)
    expect(shown.at(-1)).toBe('One thing')

    r.settle()
    expect(shown.at(-1)).toBe(SENTENCE)
    expect(r.running).toBe(false)

    // and nothing lands afterwards
    const count = shown.length
    vi.advanceTimersByTime(5000)
    expect(shown).toHaveLength(count)
  })

  it('DROPS a pending arm when it abandons, rather than firing it', () => {
    // The arm is a promise about whose turn it is. By the time anything settles a reveal, it is no
    // longer true — firing it there would hand the turn over on a sentence nobody finished hearing.
    const r = createReveal(host)
    r.say(SENTENCE)
    r.arm()
    r.settle()
    expect(arms).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(arms).toBe(0)
  })

  it('replaces a reveal still running, showing the abandoned sentence in full first', () => {
    const r = createReveal(host)
    r.say('the first thing said')
    vi.advanceTimersByTime(45)
    r.say('the second thing said')
    expect(shown).toContain('the first thing said')
    expect(shown.at(-1)).toBe('the')
    vi.advanceTimersByTime(5000)
    expect(shown.at(-1)).toBe('the second thing said')
  })

  it('shows a one-word sentence at once, with no timer to hold a turn', () => {
    const r = createReveal(host)
    r.say('Yes')
    expect(shown).toEqual(['Yes'])
    expect(r.running).toBe(false)
    // The arm that follows takes the direct branch, which is the tick it would have fired on anyway.
    r.arm()
    expect(arms).toBe(1)
  })

  it('shows the whole sentence at once when less motion is asked for', () => {
    reduced = true
    const r = createReveal(host)
    r.say(SENTENCE)
    expect(shown).toEqual([SENTENCE])
    expect(r.running).toBe(false)
    r.arm()
    expect(arms).toBe(1)
  })

  it('reads the motion preference per sentence, not once at construction', () => {
    const r = createReveal(host)
    reduced = true
    r.say(SENTENCE)
    expect(shown).toEqual([SENTENCE])
    reduced = false
    r.say(SENTENCE)
    expect(shown.at(-1)).toBe('One')
  })

  it('survives an empty transcript without starting anything', () => {
    const r = createReveal(host)
    r.say('   ')
    expect(r.running).toBe(false)
    expect(shown).toEqual(['   '])
  })

  it('keeps a long sentence inside the 700ms ceiling', () => {
    const r = createReveal(host)
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ')
    r.say(long)
    vi.advanceTimersByTime(700)
    expect(shown.at(-1)).toBe(long)
  })
})
