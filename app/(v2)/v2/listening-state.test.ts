import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Option D. While the mic is open the canvas goes QUIET — the scan stops, he recedes into the veil,
// and nothing is drawn at all. What used to happen instead was a white fill and a 52-bar level meter
// ruled across him, which is a second thing claiming to be the signal at the moment the person
// talking is the signal.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const canvas = read('app/(v2)/v2/rudi-canvas.tsx').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const css = read('app/(v2)/v2/v2-tokens.css')
const button = read('app/(v2)/v2/talk-button.tsx')
const home = read('app/(v2)/v2/home-client.tsx')

describe('the canvas draws nothing while the mic is open', () => {
  const draw = canvas.slice(canvas.indexOf('function draw(now: number)'), canvas.indexOf('function paintGround'))

  it('has no meter left to draw', () => {
    expect(canvas).not.toMatch(/LV\[/)
    expect(canvas).not.toMatch(/new Float32Array/)
    expect(canvas).not.toMatch(/function envelope/)
    expect(canvas).not.toMatch(/micA/)
  })

  it('paints no veil of its own', () => {
    // The receding is the DOM scrim's job — it already sits over the canvas, it can transition its
    // own height, and a canvas fill cannot cross-fade with the composer above it. The one remaining
    // full-canvas fill is the ambient bloom, which is a gradient and is there at rest too.
    expect(draw).not.toMatch(/rgba\(250, ?250, ?252/)
    expect(draw).not.toMatch(/fillStyle = `rgba\(14, ?14, ?17/)
    expect((draw.match(/fillRect\(0, 0, CW, CH\)/g) ?? []).length).toBe(1)
  })

  it('does not brighten when the mic opens — the veil is the only thing that moves', () => {
    expect(draw).toMatch(/const pulse = st === 'speaking' \? 1 \+ 0\.12 \* Math\.sin\(now \/ 150\) : 1/)
  })

  it('keeps level() on the handle even though nothing renders it', () => {
    // The voice layer calls it and the handle is its contract. It records and paints nothing, which
    // is the honest state: this component was never the right owner of an audio level.
    expect(canvas).toMatch(/level\(v: number\) \{ levelledRef\.current = true/)
  })

  it('still stops the scan the frame listening begins', () => {
    expect(draw).toMatch(/scanA = st === 'idle' \? scanA \+ \(1 - scanA\) \* 0\.05 : 0/)
  })
})

describe('he recedes into the veil', () => {
  it('raises the scrim while the mic is open, and only then — it is not painted at rest', () => {
    // NOT PAINTED AT REST, and that is the whole shape of the screen now. Softening its top edge was
    // tried three ways and none worked: the frame has to be bright where the robot is and dark where
    // the copy is, and 43px of travel between them bands at any ramp anyone can write. So idle has no
    // veil, the caption carries its own ground, and the scrim is the LISTENING veil and only that.
    //
    // Opacity rather than display, or the height transition below has nothing to ease.
    expect(css).toMatch(/\.v2-scrim \{[^}]*opacity: 0;/)
    expect(css).toMatch(/\.v2-root\[data-state="listening"\] \.v2-scrim,\s*\n\.v2-root\[data-state="armed"\] \.v2-scrim \{ height: 48%; opacity: 1; \}/)
    // 36% at rest, not 62%. At 62% the scrim started 321px up an 844px frame and his base is at 519,
    // so it laid roughly 0.36 black over the bottom 38% of the machine.
    // 48% listening, not 74%: +12 points is the delta the design was specified with and the distance
    // 0.4s was chosen for — 101px. 74% was never a decision, it was 62+12 left behind when the base
    // moved, and it made the same 400ms cover 321px.
    expect(css).toMatch(/\.v2-scrim \{[^}]*height: 36%/)
  })

  it('moves it rather than covering him with something new — and the move actually animates', () => {
    // .v2-scrim declared `transition` TWICE, and the second silently won, so the height never eased
    // and the listening veil snapped. One declaration, both properties.
    expect(css).toMatch(/\.v2-scrim \{[^}]*transition: height 0\.4s var\(--v2-ease\), opacity 0\.35s/)
    const rule = css.slice(css.indexOf('.v2-scrim {'), css.indexOf('}', css.indexOf('.v2-scrim {')))
    expect((rule.match(/transition:/g) ?? []).length).toBe(1)
  })

  it('carries the caption itself, because it starts below the robot', () => {
    // The first third was 0.10, on the reasoning that a thin start leaves the robot alone. It does —
    // but the scrim's top edge is y 540 and the robot's base ends at y 501, so the whole gradient is
    // already below him and a thin start bought nothing. What it cost was the caption: the scrim
    // reached alpha 0.047 by the first line, so a local backdrop had to make up the difference, and
    // that backdrop's blurred top edge is what read as a horizontal line under the cards.
    //
    // 0.56 at 30% moves that work into the scrim, whose ramp is 91px rather than the backdrop's ~30,
    // and which begins below anything we want bright. Measured on the dev server: robot band 157 and
    // base band 146, both unchanged; the sharpest row at the scrim's top edge falls 2.31 -> 1.78,
    // against 1.35 for the photograph on its own.
    const rule = css.slice(css.indexOf('.v2-scrim {'), css.indexOf('}', css.indexOf('.v2-scrim {')))
    expect(rule).toMatch(/rgba\(10, 10, 13, 0\.56\) 30%/)
    expect(rule).toMatch(/rgba\(10, 10, 13, 0\.62\) 70%/)
    expect(rule).toMatch(/rgba\(10, 10, 13, 0\.92\) 100%/)
  })

  it('gives the headline its own readability rather than a tall veil', () => {
    // Two layers: a tight 2px pass for the glyph edge, a wide 22px pass for the field it sits on.
    expect(css).toMatch(/text-shadow: 0 1px 2px rgba\(0, 0, 0, 0\.55\), 0 2px 22px rgba\(0, 0, 0, 0\.75\)/)
  })

  it('and a local backdrop that is now the only thing making the caption readable', () => {
    // With no veil at rest this element carries the caption alone, so it was re-swept from scratch
    // against the bare plate. Two things changed and the second was the one that mattered.
    //
    // The shape went from a ramp to a plateau: it used to ramp DOWN the frame to counteract a scrim
    // getting stronger underneath it, and there is no scrim underneath it now.
    //
    // And the box starts 30px above the caption rather than 3. Alpha alone could not fix line one —
    // a flat 0.84 still only reached 4.35:1 — because line one sits in the top of the box where the
    // 20px blur has ramped the alpha most of the way down. Where the box STARTS was the limit, not
    // how dark it goes. Measured on the dev server: 6.90 / 10.53 / 6.79, floor 6.79, spread 0.11.
    //
    // -30/0.66 over -25/0.80, which scored marginally better at 7.57 and 0.00: the sharpest row on
    // the top edge is 1.92 against 2.14, and the edge is the thing this whole exercise was about.
    // The robot pays nothing either way — band 157, base 145, all of it below his feet at 505.
    const rule = css.slice(css.indexOf('.v2-cap::before {'), css.indexOf('}', css.indexOf('.v2-cap::before {')))
    expect(rule).toMatch(/inset: -30px -20px -10px/)
    expect(rule).toMatch(/rgba\(10, 10, 13, 0\) 0%/)
    expect(rule).toMatch(/rgba\(10, 10, 13, 0\.66\) 25%/)
    expect(rule).toMatch(/rgba\(10, 10, 13, 0\.66\) 85%/)
    expect(rule).toMatch(/rgba\(10, 10, 13, 0\.03\) 100%/)
    expect(rule).toMatch(/z-index: -1/)
    // The top stop must stay at zero. A non-zero first stop is a step at the box edge, and blur turns
    // a step into precisely the soft band this was written to remove.
    expect(rule).not.toMatch(/rgba\(10, 10, 13, 0\.[1-9][0-9]?\) 0%/)
    // .v2-cap must stay position:relative and set NO z-index, or the pseudo-element leaves
    // .v2-overlay's stacking context and falls behind the scrim.
    const cap = css.slice(css.indexOf('.v2-cap {'), css.indexOf('}', css.indexOf('.v2-cap {')))
    expect(cap).toMatch(/position: relative/)
    expect(cap).not.toMatch(/z-index/)
  })
  it('is told the state by the root, which is where the DOM chrome can read it', () => {
    expect(home).toMatch(/data-state=\{state\}/)
  })
})

describe('the transcript takes the resting sentence\'s place', () => {
  it('at the resting sentence\'s own size, not a 10px mono label', () => {
    const rule = css.slice(css.indexOf('.v2 .v2-root[data-state="listening"] .v2-you,'))
    expect(rule).toMatch(/font-size: 31px/)          // .v2-cap's own
    expect(rule).toMatch(/line-height: 1\.22/)
    expect(rule).toMatch(/font-weight: 600/)
    expect(rule).toMatch(/letter-spacing: -0\.03em/)
    // Specificity: `.v2 .v2-you` sets the mono treatment later in the file, so this has to outrank it.
    expect(rule.startsWith('.v2 .v2-root')).toBe(true)
  })
  it('drops the "You ·" prefix, which is what made it read as a log entry', () => {
    expect(home).toMatch(/<span className="v2-you-who">You · <\/span>\{said\}/)
    expect(css).toMatch(/\.v2-you-who,\s*\n[^{]*\.v2-you-who \{ display: none; \}/)
  })
})

describe('the button', () => {
  it('is glass while the mic is open, not the ink slab', () => {
    const glass = css.slice(css.indexOf('.v2-talk[data-on] {'), css.indexOf('.v2-talk[data-on]:hover'))
    expect(glass).toMatch(/background: rgba\(255, 255, 255, 0\.1\)/)
    expect(glass).toMatch(/border: 1px solid rgba\(255, 255, 255, 0\.2\)/)
    expect(glass).toMatch(/backdrop-filter: blur\(14px\)/)
    // The `background` shorthand above clears .v2-talk's radial by itself, so there is no separate
    // background-image here. There was one, for as long as .v2-talk declared `background` twice and the
    // shorthand's own reset could not be relied on to be the last word. See app/css-duplicates.test.ts.
    expect(glass).not.toMatch(/background-image/)
    expect(css.slice(css.indexOf('.v2-talk {'), css.indexOf('.v2-talk:active'))).not.toMatch(/linear-gradient/)
    expect(css).not.toMatch(/\.v2-talk\[data-on\] \{ background: var\(--v2-ink\)/)
  })

  it('reads End, with a rounded square instead of the mic', () => {
    expect(button).toMatch(/const StopIcon/)
    expect(button).toMatch(/<rect x="7" y="7" width="10" height="10" rx="2\.5" fill="currentColor"/)
    expect(button).toMatch(/state === 'idle' \? <MicIcon \/> : <StopIcon \/>/)
    expect(button).toMatch(/state === 'listening' \|\| state === 'speaking' \? 'End'/)
    // ARMED keeps its own word — nothing is running to stop, it is waiting for you.
    expect(button).toMatch(/: rudiState\(state\)/)
  })

  it('hugs its content and is centred, in both states', () => {
    const hug = css.slice(css.indexOf('.v2 .v2-overlay .v2-talk {'))
    expect(hug).toMatch(/width: fit-content/)
    expect(hug).toMatch(/margin-inline: auto/)
    expect(hug).toMatch(/left: 0; right: 0/)
    expect(hug).toMatch(/height: 54px; padding: 0 26px 0 8px; gap: 13px/)
    expect(hug).toMatch(/font-size: 16px/)
    expect(hug).toMatch(/box-shadow: 0 10px 30px -10px rgba\(139, 92, 246, 0\.8\)/)
    // 54 − 8 − 8 = 38. The asymmetric padding IS the mic circle's inset, which is why it cannot be
    // width: 100%.
    expect(hug).toMatch(/\.v2-mic \{ width: 38px; height: 38px; background: rgba\(255, 255, 255, 0\.22\)/)
  })

  it('lets the transcript wrap, which the echo it replaces never had to', () => {
    const rule = css.slice(css.indexOf('.v2 .v2-root[data-state="listening"] .v2-you,'))
    expect(rule).toMatch(/white-space: normal; overflow: visible; text-overflow: clip/)
    // The base rule is nowrap+ellipsis, and it stays that way for the typed echo.
    expect(css).toMatch(/\.v2-you \{[^}]*text-overflow: ellipsis/)
  })

  it('pulses no ring — the glass border is the edge', () => {
    expect(css).toMatch(/\.v2-talk\[data-on\]::after \{ opacity: 0; animation: none; \}/)
  })

  it('presses by tightening the shadow as well as shrinking', () => {
    const hug = css.slice(css.indexOf('.v2 .v2-overlay .v2-talk {'))
    expect(hug).toMatch(/:active \{\s*\n\s*transform: scale\(0\.955\);\s*\n\s*box-shadow: 0 6px 20px -8px rgba\(139, 92, 246, 0\.8\)/)
  })
})

describe('the swipe handle is inked for whatever is behind it', () => {
  // Both parts were white at a third of an alpha, drawn when a veil covered the bottom of the frame
  // at every state. With the veil gone at rest they measured 1.57:1 on the bare plate — present in
  // the markup and invisible on the screen.
  //
  // Measured on the dev server: dark 0.9 gives 5.69:1 on the bar and 5.19:1 on the label at rest;
  // white 0.6 gives 5.88:1 and 5.80:1 under the veil. The white was 0.34/0.4, which had never met AA
  // in listening either — 2.99 and 3.41 — and was raised in the same edit rather than left.

  it('is dark at rest, where the plate is light', () => {
    // Anchored to the start of a line. The state overrides sit ABOVE these in the file and contain
    // the same selector as a substring, so an unanchored indexOf finds the override and asserts the
    // wrong rule — it read the listening white and reported the resting ink missing.
    expect(css).toMatch(/\n\.v2-grab s \{[^}]*background: rgba\(10, 10, 13, 0\.9\)/)
    expect(css).toMatch(/\n\.v2-grab span \{[^}]*color: rgba\(10, 10, 13, 0\.9\)/)
  })

  it('goes back to white with the veil, by the selector that raises it', () => {
    // The same selector, not a second guess at when the plate goes dark. If the veil's condition ever
    // changes, the ink's condition changes with it.
    expect(css).toMatch(/\.v2-root\[data-state="listening"\] \.v2-grab s,\s*\n\.v2-root\[data-state="armed"\] \.v2-grab s \{ background: rgba\(255, 255, 255, 0\.6\); \}/)
    expect(css).toMatch(/\.v2-root\[data-state="listening"\] \.v2-grab span,\s*\n\.v2-root\[data-state="armed"\] \.v2-grab span \{ color: rgba\(255, 255, 255, 0\.6\); \}/)
  })
})

describe('the bottom block sits lower, as one group', () => {
  it('moves everything pinned to the bottom by ONE number', () => {
    // Move one and the group changes shape; move both by the same amount and it only changes position.
    expect(css).toMatch(/--v2-bottom-drop: 0px;/)          // desktop untouched
    expect(css).toMatch(/\.v2 \{ --v2-bottom-drop: 56px; \}/) // mobile
    expect(css).toMatch(/padding: 0 16px calc\(132px - var\(--v2-bottom-drop\) \+ env\(safe-area-inset-bottom\)\)/)
    expect(css).toMatch(/bottom: calc\(92px - var\(--v2-bottom-drop\)\)/)
  })
})

describe('desktop behaves the same, because none of it is behind a breakpoint', () => {
  it('raises the scrim and restyles the transcript at every width', () => {
    // The rules key off [data-state] on .v2-root, not on a media query. The only mobile-gated part of
    // this screen is the button's geometry, which is a layout question rather than a state one.
    const mobileOnly = css.slice(css.indexOf('@media (max-width: 719.98px)'))
    expect(mobileOnly).not.toMatch(/\.v2-scrim \{ height: 74%/)
    expect(mobileOnly).not.toMatch(/data-state="listening"\] \.v2-you/)
  })

  it('gives the glass button and its End label to both', () => {
    // .v2-talk[data-on] is declared outside every media query, and the label lives in the component.
    const glassAt = css.indexOf('.v2-talk[data-on] {')
    expect(glassAt).toBeGreaterThan(-1)
    expect(glassAt).toBeLessThan(css.indexOf('@media (max-width: 719.98px)'))
    expect(button).toMatch(/'End'/)
  })

  it('keeps the breath off on both, because it is one code path and not a per-asset choice', () => {
    const canvas = readFileSync(join(process.cwd(), 'app/(v2)/v2/rudi-canvas.tsx'), 'utf8')
    expect(canvas).not.toMatch(/0\.01 \* Math\.sin\(now \/ 3200\)/)
    expect(canvas).not.toMatch(/DW \* br/)
  })
})
