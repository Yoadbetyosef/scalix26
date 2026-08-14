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
    expect(panel).toContain('{somethingHappened && (')
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

  it('drives the canvas from useTestAi rather than owning turn-taking', () => {
    expect(panel).toContain('useTestAi(agentId)')
    // No microphone, no recognition, no thresholds, no silence timers in here.
    expect(panel).not.toMatch(/SpeechRecognition|getUserMedia|MediaRecorder|setInterval/)
  })

  it('talks to MILES, not to whoever answers the phone', () => {
    expect(panel).toContain('agentId: string')
    expect(panel).toContain('useTestAi(agentId)')
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

describe('the five things the merge broke', () => {
  const panel = strip(read('./panel.tsx'))
  const groups = strip(read('./groups.tsx'))

  it('2. the panel is a portrait on desktop, not a full-bleed strip', () => {
    const css = read('../v2-tokens.css')
    const wide = css.slice(css.indexOf('THE PANEL IS A PORTRAIT'))
    expect(wide).toMatch(/width: 400px/)
  })

  it('3. at rest on a phone he is a still frame', () => {
    expect(panel).toContain('minimised={stillAtRest}')
    // `useIsMobile` is a tri-state and `!null` is true — the unknown case must not read as mobile.
    expect(panel).toContain('isMobile === true && !callActive')
  })

  it('4. the meter measures whoever is making the sound', () => {
    expect(panel).toContain('useVoiceLevels({ send: level, audio: audioRef, callActive, listening, speaking })')
    const levels = strip(read('./use-levels.ts'))
    expect(levels).toContain('getUserMedia')            // yours, while he listens
    expect(levels).toContain('createMediaElementSource') // his, while he speaks
  })

  it('4. speaking means audible, not requested', () => {
    // It used to flip true before the TTS request was sent, so the mouth moved through the silence.
    const hook = strip(read('../../../../lib/test-ai/use-test-ai.ts'))
    expect(hook).toContain('audio.onplaying = () => { setPending(false); setSpeaking(true) }')
    expect(hook).not.toMatch(/async function speakText\(text: string\) \{\s*setSpeaking\(true\)/)
  })

  it('5. the opening line has no separator of its own to leave behind', () => {
    // ".2 need you outright." — the full stop was in a ternary that rendered even when the clause
    // before it did not.
    expect(groups).not.toMatch(/\? <span>\. <\/span> : <span>\.<\/span>/)
  })

  it('5. and it is not said twice when the panel is already saying it', () => {
    expect(groups).toContain('{!milesId && (')
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
