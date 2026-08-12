import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// While she is audible, nothing may take the screen off her.
//
// The rule is enforced in ONE place — inside emit() — because it was previously enforced in none, and
// two separate paths broke it independently: UserStartedSpeaking ended her turn while skipping the
// drain, and ConversationText role=user emitted arm() unconditionally. A per-call-site fix would have
// left the next call site to rediscover this.

const src = readFileSync(join(process.cwd(), 'components/dashboard/hero/amy-realtime.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

describe('the guard lives in emit and covers every call site', () => {
  it('names the three moments that take the screen off her', () => {
    expect(src).toMatch(/TAKES_SCREEN_OFF_HER: AmyMoment\['type'\]\[\] = \['arm', 'listen', 'stopSpeaking'\]/)
  })

  it('drops them while scheduled audio is ahead of the context clock', () => {
    expect(src).toMatch(/playHeadRef\.current > c\.currentTime \+ 0\.05/)
    expect(src).toMatch(/if \(TAKES_SCREEN_OFF_HER\.includes\(m\.type\) && stillAudible\(\)\)/)
  })

  it('has no immediate escape hatch left', () => {
    // `endSpeaking(true)` skipped the drain and was the reason fixing the drain changed nothing. An
    // unused parameter is how it comes back.
    expect(src).not.toMatch(/endSpeaking\(true\)/)
    expect(src).not.toMatch(/immediate/)
  })

  it('a barge-in still cuts the sound before ending the turn', () => {
    // stopPlayback() zeroes the play head, which is what opens the guard on the same tick.
    expect(src).toMatch(/stopPlayback\(\); endSpeaking\(\)/)
    expect(src).toMatch(/playHeadRef\.current = 0/)
  })
})
