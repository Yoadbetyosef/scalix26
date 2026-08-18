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

  it('keeps the ramp through a portrait swap', () => {
    // The ramp used to be three RGB triples written by hand in this file. Whatever else moved, these
    // three numbers must not have — the cyan band is the product's colour before it is an echo of
    // anything in the photograph, so it survived the scan rebuild deliberately.
    expect(PERSONAS.rudi.ramp!.map(hexToRgb)).toEqual([[34, 211, 238], [139, 92, 246], [255, 46, 147]])
  })

  it('but the ground is MEASURED from the portrait, so it moves when she does', () => {
    // Miles's record set the rule: his ground is the acid his own photograph was shot against,
    // measured from the file rather than guessed, so there is no seam at its edge. Rudi's new
    // portrait is a mid-grey field, and #0d0d10 behind it would have seamed.
    expect(PERSONAS.rudi.ground).toBe('#a1a3a4')
    // Every persona has one, and none of them is a guess.
    for (const k of Object.keys(PERSONAS) as Array<keyof typeof PERSONAS>) {
      expect(PERSONAS[k].ground, k).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('and Rudi has no mesh, because nothing draws one for her any more', () => {
    // The scan replaced the node network. Miles keeps his — he keeps the loop that draws it.
    // See lib/invoices/OUTSTANDING.md §11.
    expect(PERSONAS.rudi.nodes).toBeNull()
    expect(PERSONAS.miles.nodes).toBe('/v2/miles-nodes.json')
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

  it('has ONE control on the portrait, and it is the mic', () => {
    // The technical mic is what the mockups draw and what belongs on his photograph. The lifted
    // TalkButton stays where it came from — the composer bar on the home screen.
    expect(panel).toContain('className="v2-mmic"')
    expect(panel).not.toContain('<TalkButton')
    const composer = strip(read('../composer.tsx'))
    expect(composer).toContain('<TalkButton')
  })

  it('the mic and the ring are the same button on the same handler', () => {
    // The hover state is a skin. A second element with its own onClick would be a third path into the
    // session, which is the thing this whole change exists to prevent.
    const clicks = [...panel.matchAll(/onClick=\{toggle\}/g)]
    expect(clicks.length).toBeGreaterThanOrEqual(2)   // the canvas, and the mic
    expect(panel).toContain('<em className="v2-mmlab">{live ? \'END\' : \'TALK\'}</em>')
  })

  it('borrows the ring’s own values rather than inventing them', () => {
    const css = read('../v2-tokens.css')
    const ring = css.slice(css.indexOf('THE MIC, AND THE RING IT BECOMES'))
    expect(ring).toMatch(/width: 84px; height: 84px; border-radius: 50%/)
    expect(ring).toMatch(/background: rgba\(255, 255, 255, 0\.1\); border-color: rgba\(255, 255, 255, 0\.75\)/)
    expect(ring).toMatch(/font-size: 9px; letter-spacing: 0\.18em/)
  })

  it('never dims a portrait under a finger', () => {
    const css = read('../v2-tokens.css')
    const ring = css.slice(css.indexOf('THE MIC, AND THE RING IT BECOMES'))
    expect(ring).toMatch(/@media \(hover: hover\) and \(pointer: fine\)/)
    // The dim and the morph are both inside that query.
    expect(ring.slice(ring.indexOf('@media'))).toContain('.v2-mdim { opacity: 1; }')
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

describe('mobile — R1', () => {
  const css = read('../v2-tokens.css')
  const r1 = css.slice(css.indexOf('MOBILE — R1'))
  const groups = strip(read('./groups.tsx'))
  const panel = strip(read('./panel.tsx'))

  it('is entirely inside a max-width query — desktop cannot reach any of it', () => {
    expect(r1).toMatch(/@media \(max-width: 1099px\)/)
    // Everything after the query opener stays inside it: no rule closes back out to the top level.
    const body = r1.slice(r1.indexOf('@media (max-width: 1099px) {'))
    const opens = (body.match(/\{/g) ?? []).length
    const closes = (body.match(/\}/g) ?? []).length
    expect(opens).toBe(closes)
  })

  it('the hero is a card in the scroller, at the reference’s values', () => {
    expect(r1).toMatch(/height: 330px;[^}]*border-radius: 26px/)
    expect(r1).toMatch(/box-shadow: 0 10px 34px -14px rgba\(0, 0, 0, 0\.4\)/)
    expect(r1).toMatch(/padding: 0 14px 30px/)
  })

  it('one scroll container, not two', () => {
    // .v2-mbody was `display: contents` on a phone — a wrapper that did nothing. It scrolls now, and
    // .v2-pbody stops scrolling, so the hero and the groups move together.
    expect(r1).toMatch(/\.v2-mbody \{\s*display: block; flex: 1; min-height: 0; overflow-y: auto/)
    expect(r1).toMatch(/\.v2-pbody \{ overflow: visible; padding: 0; flex: none; \}/)
  })

  it('collapses to a bar, on the reference’s curve', () => {
    // The threshold pair lives in collapse.ts and is tested there; one line could not hold.
    expect(groups).toContain('nextCollapsed(collapsed, el.scrollTop)')
    expect(r1).toMatch(/\[data-min\] \.v2-mpanel \{ height: 78px; border-radius: 22px; \}/)
    expect(r1).toMatch(/height 0\.62s cubic-bezier\(0\.32, 0\.72, 0, 1\)/)
    expect(r1).toMatch(/\[data-min\] \.v2-mmic \{ width: 46px; height: 46px; border-radius: 15px; \}/)
  })

  it('swaps the long line for the counts, without re-rendering the list', () => {
    expect(panel).toContain('className="v2-mminlab"')
    // The attribute is written to the node; a thumb moving must not re-render the inbox.
    expect(groups).toContain('el.dataset.min')
    expect(groups).not.toMatch(/setCollapsed|useState<boolean>\(false\)/)
    // Scroll anchoring moves scrollTop to keep visible content still when something above it
    // resizes — which is exactly what the hero collapsing is. Left on, it fights the threshold.
    expect(r1).toMatch(/overflow-anchor: none/)
  })

  it('the group header loses its dot and its coloured pill', () => {
    expect(r1).toMatch(/\.v2-mgl i \{ display: none; \}/)
    expect(r1).toMatch(/letter-spacing: 0\.18em; color: var\(--v2-ink-42\)/)
    expect(r1).toMatch(/\.v2-mgl em \{[^}]*background: none !important/)
  })

  it('"first time" keeps its words on a phone', () => {
    // It WAS a bare 7px magenta dot here, which was defensible while the chip meant "unanswered" and
    // the group heading already said so. It means "you have not heard from this person before" now,
    // and nothing about a dot says that. The name gives up its width instead.
    expect(r1).toMatch(/\.v2-mnew \{ font-size: 8\.5px; padding: 2px 5px; \}/)
    expect(r1).not.toMatch(/\.v2-mnew \{[^}]*width: 7px/)
    expect(r1).not.toMatch(/\.v2-mnew \{[^}]*font-size: 0/)
  })

  it('rows and cards take the refined values', () => {
    expect(r1).toMatch(/\.v2-mrow \{ gap: 13px; padding: 15px 14px; min-height: 70px; \}/)
    expect(r1).toMatch(/\.v2-mav \{ width: 38px; height: 38px; border-radius: 12px; \}/)
    expect(r1).toMatch(/box-shadow: 0 1px 2px rgba\(0, 0, 0, 0\.04\), 0 8px 22px -12px rgba\(0, 0, 0, 0\.14\)/)
    expect(r1).toMatch(/\.v2-msep \{ margin-left: 65px/)
    expect(r1).toMatch(/font-size: 15\.5px/)
  })
})

describe('he is alive on a phone', () => {
  const canvas = readFileSync(new URL('../rudi-canvas.tsx', import.meta.url), 'utf8')
  const panel = strip(read('./panel.tsx'))

  it('runs the FULL engine at rest — mesh and sweep, as the desktop draws it', () => {
    // The still-at-rest rule removed the mesh, and the mesh crossed by the sweep is the thing that
    // makes the portrait read as an employee rather than a screenshot of one.
    expect(panel).not.toContain('minimised=')
    expect(panel).not.toContain('stillAtRest')
  })

  it('touching the portrait scans him and does not open a conversation', () => {
    // A portrait that fills a phone screen is far too easy to open by accident, and an accidental
    // call is a real one. The mic is the only way in on a phone.
    expect(panel).toContain('isMobile === true ? face.current?.scan() : toggle()')
  })

  it('decides that at click time, not at render', () => {
    // useIsMobile returns null until it has measured; a first render must not decide it.
    expect(panel).toContain('onClick={() => (isMobile === true')
  })

  it('scan is presentation only — it starts and ends nothing', () => {
    const fn = canvas.slice(canvas.indexOf('scan() {'), canvas.indexOf('endSession() {'))
    expect(fn).toContain('scanAtRef.current = performance.now()')
    expect(fn).not.toMatch(/setState|listen|speak|endSession/)
  })

  it('a tap starts the sweep from the top rather than joining one halfway down', () => {
    expect(canvas).toContain('const prog = ((now - scanAtRef.current) % period) / period')
  })

  it('the collapsed path runs the SAME sweep the full engine runs', () => {
    // It used to draw one slow band every 5.2s — about 1.8s of movement in every 5, which reads as a
    // static photograph unless you happen to be looking at the right moment.
    expect(canvas).toContain('function drawSweep(')
    expect((canvas.match(/drawSweep\(/g) ?? []).length).toBe(3)   // the definition and two callers
  })

  it('and still pays for none of the rest', () => {
    const collapsed = canvas.slice(canvas.indexOf('if (minRef.current) {'))
    const branch = collapsed.slice(0, collapsed.indexOf('return\n      }'))
    // No mesh, no bloom, no video, no meter in the collapsed path.
    expect(branch).not.toMatch(/ensureNet|net\.|createRadialGradient|drawImage\(vid/)
    expect(branch).toContain('if (v && !v.paused) v.pause()')
  })

  it('sweeps at the same rate the desktop does at idle', () => {
    expect(canvas).toContain('const prog = (now % 3600) / 3600')
  })

  it('refuses to animate under reduced motion, exactly as before', () => {
    // Unchanged on purpose: the guard stays, and the sweep sits inside it.
    expect(canvas).toContain('if (running || reduced || disposed) return')
    const collapsed = canvas.slice(canvas.indexOf('if (minRef.current) {'))
    expect(collapsed.indexOf('if (!reduced) {')).toBeLessThan(collapsed.indexOf('drawSweep('))
  })

  it('the loop starts for someone who only ever scrolls', () => {
    // `scroll` does not bubble, so a listener on window never hears a scroll inside an element — and
    // the mobile inbox scroller IS an element. The capture phase reaches it.
    expect(canvas).toContain("window.addEventListener(e, kick, { passive: true, capture: true })")
    expect(canvas).toContain("window.removeEventListener(e, kick, { capture: true })")
  })
})
