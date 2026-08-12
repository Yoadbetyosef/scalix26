import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A session that ends in the UI while the socket stays open is the failure this guards. Every ending
// must go through teardown, and teardown must report what it released.

const raw = readFileSync(join(process.cwd(), 'components/dashboard/hero/amy-realtime.tsx'), 'utf8')
const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const v2 = readFileSync(join(process.cwd(), 'app/(v2)/v2/home-client.tsx'), 'utf8')

describe('every ending releases the socket, the mic and the audio graph', () => {
  it('teardown closes the socket and stops every track', () => {
    expect(src).toMatch(/ws\?\.close\(\)/)
    expect(src).toMatch(/tracks\.forEach\(\(t\) => t\.stop\(\)\)/)
  })

  it('an owned context is closed and a borrowed one suspended', () => {
    // Closing a borrowed context would kill the parent's next session; leaving it running holds an
    // audio graph open. Suspend is the honest middle.
    expect(src).toMatch(/ownsCtxRef\.current[\s\S]*ctx\.close\(\)/)
    expect(src).toMatch(/ctx\.suspend\(\)/)
  })

  it('reports what it released, and flags any track still live', () => {
    expect(src).toMatch(/\[amy session\] ENDED/)
    expect(src).toMatch(/stillLive: live/)
  })

  it('is idempotent — four paths can call it for one session', () => {
    expect(src).toMatch(/if \(tornDownRef\.current\) return\s*\n\s*tornDownRef\.current = true/)
  })
})

describe('the four ways a session ends itself', () => {
  it('1. inactivity — but ONLY her question going unanswered', () => {
    expect(src).toMatch(/const IDLE_END_MS = 10_000/)
    expect(src).toMatch(/endSession\(`no speech for \$\{IDLE_END_MS \/ 1000\}s`\)/)
  })

  it('the clock starts in exactly one place: her turn ending', () => {
    // Armed at connect and re-armed on any speech, it was a session-age timer wearing the word idle
    // and it hung up ten seconds into a live conversation.
    expect(src.match(/armIdle\(\)/g) ?? []).toHaveLength(1) // exactly one call site, and this is it
    const finish = src.slice(src.indexOf('const finish = ()'), src.indexOf('const ctx = ctxRef.current'))
    expect(finish).toMatch(/armIdle\(\)/)
  })

  it('the owner speaking cancels it rather than restarting it', () => {
    expect(src).toMatch(/const answered = \(\) => clearIdle\(\)/)
    // Both places the owner's speech is observed.
    expect(src.match(/answered\(\)/g) ?? []).toHaveLength(2) // UserStartedSpeaking + ConversationText
  })

  it('connecting does not start it — nothing is waiting on an answer yet', () => {
    const welcome = src.slice(src.indexOf("case 'Welcome'"), src.indexOf("case 'UserStartedSpeaking'"))
    expect(welcome).not.toMatch(/armIdle/)
  })

  it('2. intent — after her reply finishes, not before', () => {
    // The flag is set on the user's line and honoured in finish(), so she gets her last word out.
    expect(src).toMatch(/if \(soundsFinal\(msg\.content \|\| ''\)\) closingRef\.current = true/)
    expect(src).toMatch(/if \(closingRef\.current\) \{ endSession\('you said goodbye'\); return \}/)
  })

  it('3. a hidden tab, on a shorter fuse than idle', () => {
    expect(src).toMatch(/const HIDDEN_END_MS = 30_000/)
    expect(src).toMatch(/document\.addEventListener\('visibilitychange'/)
  })

  it('4. unmount, which is what a route change is', () => {
    expect(src).toMatch(/useEffect\(\(\) => \(\) => \{ teardown\('unmounted'\) \}, \[\]\)/)
    // And a closed tab, which never runs React cleanup.
    expect(src).toMatch(/window\.addEventListener\('pagehide', bye\)/)
  })
})

describe('closing intent is matched on whole lines only', () => {
  // Reconstructed from the source so the test cannot drift from the shipped patterns.
  const body = raw.slice(raw.indexOf('const CLOSERS'), raw.indexOf('const soundsFinal'))
  const patterns = [...body.matchAll(/\/\^(.+?)\/i,/g)].map((m) => new RegExp('^' + m[1], 'i'))
  const closes = (t: string) => patterns.some((r) => r.test(t.trim()))

  it.each(['thanks', 'Thank you', "that's all", 'bye', 'talk to you soon', "I'm good", 'ok thanks, bye'])(
    'ends on %j', (t) => expect(closes(t)).toBe(true),
  )

  it.each([
    'thanks for booking that, can you also call them',
    'that is all the detail I have, what next',
    'no, book it for later',
    'goodbye party for Marcus — put it in the calendar',
  ])('keeps going on %j', (t) => expect(closes(t)).toBe(false))
})

describe('the v2 END press does the full teardown', () => {
  it('closes the session rather than flipping a state', () => {
    // amy.close() unmounts AmyRealtime, whose unmount effect tears down.
    expect(v2).toMatch(/amy\.close\(\); onEnded\(\)/)
  })

  it('every ending collapses her to the corner, including the button', () => {
    // Ending has to be visible. The button cannot reach onClose (it unmounts the panel), so it calls
    // onEnded directly; the other three arrive through AmyLayer's onClose.
    expect(v2).toMatch(/setMinimised\(true\)/)
    expect(readFileSync(join(process.cwd(), 'app/(v2)/v2/deferred.tsx'), 'utf8'))
      .toMatch(/session\.close\(\); onEnded\?\.\(\)/)
  })

  it('says the microphone is live, since the cursor is hidden during a session', () => {
    expect(v2).toMatch(/Microphone live · press to end/)
    expect(v2).toMatch(/active=\{!typing && amy\.mode === 'idle'\}/)
  })
})
