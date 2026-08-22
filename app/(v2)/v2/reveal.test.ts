import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { revealStepMs } from './home-client'

// The agent sends no partial recognition — one ConversationText about 700ms after the endpoint,
// carrying the whole sentence. So the reveal is presentation, and it lives in home-client rather than
// in the socket layer, which reports what was said and should not also own how long a screen takes
// to say it.

const src = readFileSync(join(process.cwd(), 'app/(v2)/v2/home-client.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

describe('the pace', () => {
  it('is 45ms a word until the cap starts biting', () => {
    for (const n of [1, 2, 5, 10, 15]) expect(revealStepMs(n)).toBe(45)
  })

  it('and the length of the sentence never decides how long the wait is', () => {
    // A twenty-word transcript at 45ms would hold the turn for nearly a second.
    expect(revealStepMs(16)).toBeCloseTo(43.75, 5)
    expect(revealStepMs(40)).toBeCloseTo(17.5, 5)
    for (const n of [1, 2, 16, 40, 200]) {
      expect(revealStepMs(n) * n).toBeLessThanOrEqual(700 + 1e-9)
    }
  })

  it('cannot divide by nothing', () => {
    expect(revealStepMs(0)).toBe(45)
  })
})

describe('what the reveal costs the state machine', () => {
  it('HOLDS the arm rather than delaying the moment', () => {
    // amy-realtime drops arm/listen/stopSpeaking while she is still audible, and a dropped arm never
    // re-fires. So the moment is taken on the tick it was sent, past that guard, and only the CALL
    // waits for the last word.
    expect(src).toMatch(/m\.type === 'arm'\) \{ if \(revealTimer\.current\) armPending\.current = true; else r\.arm\(\) \}/)
    expect(src).toMatch(/if \(armPending\.current\) arm\(\)/)
  })

  it('arms on the tick the last word lands', () => {
    const fn = src.slice(src.indexOf('const revealSaid'), src.indexOf('useEffect(() => settleReveal'))
    expect(fn).toMatch(/if \(i < words\.length\) return/)
    expect(fn).toMatch(/revealTimer\.current = null/)
  })

  it('abandons the sentence when she answers or the caller starts again', () => {
    // A half-finished sentence under her reply is the failure this exists to prevent.
    expect(src).toMatch(/m\.type === 'listen'\) \{ settleReveal\(\); r\.listen\(\) \}/)
    expect(src).toMatch(/m\.type === 'speak'\) \{ settleReveal\(\);/)
  })

  it('DROPS a pending arm when it abandons, rather than firing it', () => {
    // `armed` is a promise about whose turn it is. By the time she is speaking, it is not true.
    const settle = src.slice(src.indexOf('const settleReveal'), src.indexOf('const revealSaid'))
    expect(settle).toMatch(/armPending\.current = false/)
    expect(settle).toMatch(/setSaid\(revealFull\.current\)/)
  })

  it('clears the interval when the component goes away', () => {
    expect(src).toMatch(/useEffect\(\(\) => settleReveal, \[settleReveal\]\)/)
  })

  it('never animates the typed path', () => {
    // The words were already on screen in the field; revealing them would be the screen re-typing
    // what somebody just typed.
    const submit = src.slice(src.indexOf('const onSubmit'), src.indexOf('const onMoment'))
    expect(submit).toMatch(/settleReveal\(\)/)
    expect(submit).toMatch(/setSaid\(text\)/)
    expect(submit).not.toMatch(/revealSaid/)
  })

  it('goes straight to the sentence under reduced motion, and for a single word', () => {
    const fn = src.slice(src.indexOf('const revealSaid'), src.indexOf('useEffect(() => settleReveal'))
    expect(fn).toMatch(/prefers-reduced-motion: reduce/)
    expect(fn).toMatch(/if \(words\.length < 2 \|\| reduced\) \{ setSaid\(text\); if \(armPending\.current\) arm\(\); return \}/)
  })

  it('uses refs, because said and arm arrive on the same tick', () => {
    // They are emitted back to back in one synchronous sequence — state would not have settled.
    expect(src).toMatch(/const revealTimer = useRef/)
    expect(src).toMatch(/const armPending = useRef\(false\)/)
  })
})
