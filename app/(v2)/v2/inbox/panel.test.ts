import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { PERSONAS, hexToRgb } from '@/lib/persona'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

describe('the panel is silent when there is nothing', () => {
  const panel = strip(read('./panel.tsx'))

  it('shows no line and no count unless something actually happened', () => {
    // A panel that says "0 drafts waiting" every morning teaches its owner to stop reading it.
    expect(panel).toContain('const somethingHappened = sent > 0 || waiting > 0 || needs > 0')
    // The line appears when something happened OR when he has just said something — silence means
    // silence, but an answer is not silence.
    expect(panel).toContain('{(reply || somethingHappened) && (')
  })

  it('never renders a zero', () => {
    // Each figure is behind its own guard, so "Sent 0." cannot appear either.
    expect(panel).toContain('{sent > 0 &&')
    expect(panel).toContain('{waiting > 0 &&')
    expect(panel).toContain('{needs > 0 &&')
  })
})

describe('one state machine, not two', () => {
  const panel = strip(read('./panel.tsx'))

  it('owns no turn-taking: no microphone, no recognition, no timers', () => {
    expect(panel).not.toMatch(/SpeechRecognition|getUserMedia|MediaRecorder|setInterval/)
  })

  it('talks as MILES — his voice and his brief, not the tenant’s default employee', () => {
    expect(panel).toContain('milesBriefing(facts)')
    expect(panel).toContain('buildMilesPrompt(facts)')
  })
})

describe('the same engine paints both employees', () => {
  const canvas = strip(read('../rudi-canvas.tsx'))

  it('takes the persona as an argument', () => {
    expect(canvas).toContain("persona = 'rudi'")
    expect(canvas).toContain('paintFor(persona)')
  })

  it('still paints Rudi exactly as it did', () => {
    // The ramp used to be three RGB triples written by hand in this file. Whatever else moved, these
    // three numbers must not have.
    expect(PERSONAS.rudi.ramp!.map(hexToRgb)).toEqual([[34, 211, 238], [139, 92, 246], [255, 46, 147]])
    expect(PERSONAS.rudi.ground).toBe('#0d0d10')
  })

  it('tolerates an employee with no speaking loop and no mesh', () => {
    // Miles had neither for two stages, and a persona added later may have neither again.
    expect(canvas).toContain('if (NODES) fetch(NODES)')
    expect(canvas).toContain('src={VIDEO ?? undefined}')
  })
})

describe('the mesh that was generated from the portrait', () => {
  const nodes = JSON.parse(readFileSync(new URL('../../../../public/v2/miles-nodes.json', import.meta.url), 'utf8'))

  it('has the shape the canvas reads', () => {
    expect(nodes.count).toBe(900)
    expect(nodes.points).toHaveLength(900)
    expect(nodes.points.every((p: number[]) => p.length === 2)).toBe(true)
  })

  it('stays inside the portrait it was sampled from', () => {
    const [x0, x1] = nodes.extent.x
    const [y0, y1] = nodes.extent.y
    expect(x0).toBeGreaterThanOrEqual(0)
    expect(x1).toBeLessThan(680)
    expect(y0).toBeGreaterThanOrEqual(0)
    expect(y1).toBeLessThanOrEqual(907)
  })

  it('sits on the subject, not on the ground behind him', () => {
    // The generator weights each pixel by its distance from the photograph's own background, so the
    // top corners — pure acid — should hold no points at all.
    const inCorner = nodes.points.filter(([x, y]: number[]) => (x < 90 || x > 590) && y < 90)
    expect(inCorner).toHaveLength(0)
  })
})

describe('one inbox, not two', () => {
  it('the separate Messages screen is gone', () => {
    // It existed for one stage, as a place to build Miles without deleting the reskin. Two inboxes is
    // one more than a person has.
    expect(existsSync(new URL('../messages', import.meta.url))).toBe(false)
  })

  it('the nav does not offer a second one', () => {
    const nav = strip(read('../nav.ts'))
    expect(nav).not.toContain('/v2/messages')
    expect((nav.match(/label: 'Inbox'/g) ?? []).length).toBe(1)
  })

  it('the inbox route renders the groups', () => {
    expect(strip(read('./page.tsx'))).toContain('<InboxGroups')
  })

  it('calls sit in the handled group, attributed to whoever took them', () => {
    const groups = strip(read('./groups.tsx'))
    expect(groups).toContain('{row.by}')
    expect(groups).toContain("row.spoken ? ' (call)' : ''")
  })

  it('the panel counts only Miles’s own work, not the inbox total', () => {
    // The calls in that group are Rudi's; a panel that counted them would credit the wrong employee
    // on his own portrait.
    expect(strip(read('./groups.tsx'))).toContain('handled.filter((r) => r.byAgentId === milesId).length')
  })
})

describe('the floating rail', () => {
  const css = read('../v2-tokens.css')
  const rail = css.slice(css.indexOf('THE FLOATING RAIL'))
  const panel = strip(read('./panel.tsx'))

  it('is a card in a gutter, at the reference’s own values', () => {
    expect(rail).toMatch(/grid-template-columns: 300px 1fr/)
    expect(rail).toMatch(/padding: 20px 0 20px 20px/)
    expect(rail).toMatch(/border-radius: 18px/)
    expect(rail).toMatch(/box-shadow: 0 6px 26px rgba\(0, 0, 0, 0\.10\), 0 1px 3px rgba\(0, 0, 0, 0\.05\)/)
    expect(rail).toMatch(/height: 330px/)
  })

  it('the button cannot be clipped at any window height', () => {
    // A flex column at full height, a spacer that absorbs everything left over, and stats that are
    // allowed to scroll (min-height: 0) so the shortfall never comes out of the button.
    expect(css).toMatch(/\.v2 \.v2-mrail \{ display: flex; flex-direction: column; height: 100%; \}/)
    expect(rail).toMatch(/\.v2-mspacer \{ display: block; flex: 1 1 auto; min-height: 0; \}/)
    expect(rail).toMatch(/\.v2-mstats \{[^}]*min-height: 0; overflow-y: auto/)
    expect(rail).toMatch(/\.v2-mask \{[^}]*flex: none/)
  })

  it('caps the threads so rows stop running the monitor width', () => {
    expect(rail).toMatch(/\.v2-minner \{ max-width: 820px/)
  })

  it('tints a held row', () => {
    expect(css).toMatch(/linear-gradient\(90deg, rgba\(245, 165, 36, 0\.055\), transparent\)/)
  })

  it('leaves the phone alone — the rail’s blocks do not exist below the breakpoint', () => {
    expect(css).toMatch(/\.v2 \.v2-msay, \.v2 \.v2-mstats, \.v2 \.v2-mspacer, \.v2 \.v2-mask \{ display: none; \}/)
    expect(css).toMatch(/\.v2 \.v2-mbody \{ display: contents; \}/)
  })

  it('the counts are the filter', () => {
    expect(panel).toContain("onOnly(only === key ? null : key)")
  })
})

describe('the conversation that greeted and then listened to nothing', () => {
  const hook = strip(read('../../../../lib/test-ai/use-test-ai.ts'))

  it('handlers that outlive their render read the live call state, not a captured one', () => {
    // startCall sets callActive and speaks in the SAME pass, so the greeting's `ended` handler closed
    // over `false` and never started listening. The whole conversation then sat armed: no transcript,
    // no send, no reply, and a meter the canvas flattens by design because it is not in `listening`.
    expect(hook).toContain('if (callActiveRef.current) startListening()')
    expect(hook).not.toMatch(/audio\.onended = [^\n]*if \(callActive\)/)
    expect(hook).toContain('callActiveRef.current = true')
    expect(hook).toContain('callActiveRef.current = false')
  })

  it('a recogniser only speaks for itself', () => {
    // Aborting the previous one fires ITS onend after the new one's onstart, and both wrote the same
    // flag — so a live recogniser could be marked "not listening".
    expect(hook).toContain('const mine = () => recognitionRef.current === recognition')
    expect(hook).toContain('recognition.onstart = () => { if (mine()) setListening(true) }')
    expect(hook).toContain('recognition.onend = () => { if (mine()) setListening(false) }')
  })

  it('a recogniser that refuses to start says so instead of ending the conversation silently', () => {
    expect(hook).toContain('[voice] could not start listening')
  })
})

describe('one voice loop in the codebase', () => {
  const panel = strip(read('./panel.tsx'))

  it('the panel runs the SAME session the home screen runs', () => {
    expect(panel).toContain("import { AmyRealtime, type AmyMoment } from '@/components/dashboard/hero/amy-realtime'")
    expect(panel).toContain("import { useAmySession } from '@/components/dashboard/hero/use-amy-session'")
  })

  it('and owns no turn-taking of its own', () => {
    // Every one of these was in the second implementation, and every one of them failed in its own
    // way: recognition it started and stopped, an audio element it timed, an analyser it read.
    for (const ghost of [
      'useTestAi', 'useVoiceLevels', 'SpeechRecognition', 'getUserMedia',
      'createMediaElementSource', 'new Audio', 'onplaying', 'setSpeaking',
    ]) {
      expect(panel).not.toContain(ghost)
    }
  })

  it('projects the session’s moments onto the canvas and decides nothing', () => {
    expect(panel).toContain("if (m.type === 'listen') f.listen()")
    expect(panel).toContain("else if (m.type === 'level') f.level(m.value)")
    expect(panel).toContain("else if (m.type === 'speak')")
    expect(panel).toContain("else if (m.type === 'arm') f.arm()")
  })

  it('unlocks the audio context inside the tap, via the session that already did', () => {
    // The autoplay policy needs the context created in the gesture; useAmySession does that and plays
    // a one-sample buffer for iOS. The panel does not have its own copy of that either.
    expect(panel).toContain('session.goLive()')
    expect(panel).not.toContain('new AudioContext')
  })

  it('does not weaken the noise gate it inherits', () => {
    // The gate exists because an employee's own TTS is transcribed as user speech. It lives in the
    // session; nothing here may re-implement, disable or duplicate it.
    const realtime = readFileSync(new URL('../../../../components/dashboard/hero/amy-realtime.tsx', import.meta.url), 'utf8')
    expect(realtime).toContain('LAYER 4 client gate')
    expect(panel).not.toMatch(/floor|hangover|gate/i)
  })

  it('the persona changes the portrait, the ground, the voice and the brief — and nothing else', () => {
    expect(panel).toContain('persona="miles"')
    expect(panel).toContain('briefing={milesBriefing(facts)}')
    expect(panel).toContain('prompt={buildMilesPrompt(facts)}')
    // The dashboard's data snapshot is another employee's job description.
    expect(panel).toContain('snapshotUrl={null}')
  })

  it('has the same press-to-talk control, over the portrait', () => {
    expect(panel).toContain('<TalkButton state={state} onTalk={toggle}')
    expect(panel).toContain('variant="onPortrait"')
    const composer = strip(read('../composer.tsx'))
    expect(composer).toContain('<TalkButton')
  })
})

describe('the brief is his own job', () => {
  const brief = readFileSync(new URL('../../../../lib/miles/briefing.ts', import.meta.url), 'utf8')

  it('tells him what he is holding, what needs a person, and what he sent', () => {
    expect(brief).toContain('HELD, AND WHY')
    expect(brief).toContain('WAITING ON A PERSON')
    expect(brief).toMatch(/drafts are.*held, waiting on a decision/)
  })

  it('names the drafts rather than only counting them', () => {
    expect(brief).toContain('f.held.map')
    expect(brief).toContain('f.unanswered.map')
  })

  it('says out loud that he does not take calls', () => {
    expect(brief).toContain('You do not take phone calls')
  })

  it('zeroes the dashboard fields it does not use rather than inventing them', () => {
    expect(brief).toContain('handled: 0, booked: 0, recovered: 0, coverage: null')
  })
})
