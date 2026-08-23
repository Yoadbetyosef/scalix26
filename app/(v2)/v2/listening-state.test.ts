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
  it('raises the scrim while the mic is open, and only then', () => {
    expect(css).toMatch(/\.v2-root\[data-state="listening"\] \.v2-scrim,\s*\n\.v2-root\[data-state="armed"\] \.v2-scrim \{ height: 74%; \}/)
    // 36% at rest, not 62%. At 62% the scrim started 321px up an 844px frame and his base is at 519,
    // so it laid roughly 0.36 black over the bottom 38% of the machine. Measured after the change:
    // alpha at the base is 0.000 idle, and the rise to 74% still puts it at 0.334 while listening.
    expect(css).toMatch(/\.v2-scrim \{[^}]*height: 36%/)
  })

  it('moves it rather than covering him with something new — and the move actually animates', () => {
    // .v2-scrim declared `transition` TWICE, and the second silently won, so the height never eased
    // and the listening veil snapped. One declaration, both properties.
    expect(css).toMatch(/\.v2-scrim \{[^}]*transition: height 0\.4s var\(--v2-ease\), opacity 0\.35s/)
    const rule = css.slice(css.indexOf('.v2-scrim {'), css.indexOf('}', css.indexOf('.v2-scrim {')))
    expect((rule.match(/transition:/g) ?? []).length).toBe(1)
  })

  it('falls off steeply enough to leave the robot alone', () => {
    // Nothing meaningful in the first third: 0.10 at 30%, and the deep end arrives under the button.
    const rule = css.slice(css.indexOf('.v2-scrim {'), css.indexOf('}', css.indexOf('.v2-scrim {')))
    expect(rule).toMatch(/rgba\(10, 10, 13, 0\.10\) 30%/)
    expect(rule).toMatch(/rgba\(10, 10, 13, 0\.62\) 70%/)
    expect(rule).toMatch(/rgba\(10, 10, 13, 0\.92\) 100%/)
  })

  it('gives the headline its own readability rather than a tall veil', () => {
    // Two layers: a tight 2px pass for the glyph edge, a wide 22px pass for the field it sits on.
    expect(css).toMatch(/text-shadow: 0 1px 2px rgba\(0, 0, 0, 0\.55\), 0 2px 22px rgba\(0, 0, 0, 0\.75\)/)
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
    // .v2-talk sets `background` TWICE — a gradient then a radial — so background-image has to be
    // cleared too or the radial survives and the glass is opaque.
    expect(glass).toMatch(/background-image: none/)
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
