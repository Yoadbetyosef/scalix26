import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { coverFit, domeInCanvas, phaseAt, SCAN_PHASES } from './rudi-canvas'
import { PERSONAS, assetsFor } from '@/lib/persona'

// Rudi is a robot. The scan is four rings leaving the dome of his face and a halo on the glass —
// five things drawn, and nothing else. Everything the portrait loop drew ACROSS a face is gone.

const src = readFileSync(join(process.cwd(), 'app/(v2)/v2/rudi-canvas.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

const RUDI = assetsFor(PERSONAS.rudi, 'mobile')
const DESK = assetsFor(PERSONAS.rudi, 'desktop')
const DOME = RUDI.scan!

describe('the three numbers the whole thing rests on', () => {
  // Measured off the dome INCLUDING its rim, which is what the rings sit outside of. A measurement of
  // the dark glass core alone comes out at 0.672 / 0.336 / 0.096 — inside this in every direction.
  it('pins the dome to the plate it was measured off', () => {
    expect([DOME.x, DOME.y, DOME.r]).toEqual([0.684, 0.349, 0.108])
  })

  it('pins the source the fractions are fractions OF', () => {
    // A fraction is meaningless without the frame it divides. Both media are this size, and both were
    // extracted byte-identically so neither has been re-encoded away from it.
    expect([RUDI.width, RUDI.height]).toEqual([784, 1660])
    expect(RUDI.still).toBe('/v2/rudi-robot-still.jpg')
    expect(RUDI.video).toBe('/v2/rudi-robot-speaking.mp4')
  })

  it('leaves Miles on his own dimensions and his own loop', () => {
    const m = assetsFor(PERSONAS.miles, 'mobile')
    expect([m.width, m.height]).toEqual([680, 907])
    // No scan block, so the engine gives him the sweep and the mesh he already had. He will need a
    // character from the same family eventually; it is not derived from a robot arm.
    expect(m.scan).toBeUndefined()
    expect(PERSONAS.miles.nodes).toBe('/v2/miles-nodes.json')
    // One set, so desktop resolves to the same object rather than to a second photograph.
    expect(assetsFor(PERSONAS.miles, 'desktop')).toBe(m)
  })

  it('takes the mesh away from the robot, because nothing is drawn across the machine', () => {
    expect(PERSONAS.rudi.nodes).toBeNull()
  })

  it('gives the desktop hero its OWN asset, at the hero\'s own aspect', () => {
    // 1130/1210 = 0.934 against the hero's 710/760 = 0.934. Cover-fit is then a 1:1 fit — the phone
    // pair in that box threw the sides away and scaled up what was left.
    expect([DESK.width, DESK.height]).toEqual([1130, 1210])
    expect(DESK.still).toBe('/v2/rudi-robot-desktop-still.jpg')
    expect(DESK.video).toBe('/v2/rudi-robot-desktop-speaking.mp4')
  })

  it('measures the desktop dome off the desktop asset, not off the phone', () => {
    // Carried over, the phone's numbers put it 6% low and 2% left of where it actually is here.
    expect([DESK.scan!.x, DESK.scan!.y, DESK.scan!.r]).toEqual([0.5845, 0.3322, 0.0978])
  })

  it('gives each asset its OWN rings and its own halo, not only its own dome', () => {
    expect(RUDI.scan!.rings).toBe(4)
    expect(DESK.scan!.rings).toBe(3)
    // Three rings stopping just outside the rim, not four travelling a dome and a half out.
    expect(RUDI.scan!.from + RUDI.scan!.reach).toBeCloseTo(2.5, 5)
    expect(DESK.scan!.from + DESK.scan!.reach).toBeCloseTo(1.65, 5)
    // A stroke less than half as thick, and a pale blue-white rather than cyan.
    expect(DESK.scan!.stroke).toBeLessThan(RUDI.scan!.stroke / 2)
    expect(DESK.scan!.ink).toEqual([190, 235, 245])
    expect(DESK.scan!.ink).toEqual(DESK.scan!.inkFar)
    // A bloom ON the glass rather than a ring around his head, and breathing slower. If two sets of
    // numbers is the rule it applies to all of them, not only the ones that obviously differ.
    expect(DESK.scan!.halo.outer).toBe(1.22)
    expect(DESK.scan!.halo.alpha).toBe(0.05)
    expect(DESK.scan!.halo.radPerS).toBeCloseTo(7 / 4.4, 6)
    expect(RUDI.scan!.halo.radPerS).toBeCloseTo(10 / 4.4, 6)
  })
})

describe('the mapping — image space through the fit, never a fraction of the canvas', () => {
  const at = (cw: number, ch: number) => {
    const f = coverFit(cw, ch, RUDI.width, RUDI.height, DOME)
    const d = domeInCanvas(f, RUDI.width, RUDI.height, DOME)
    return { f, d, downFrac: d.y / ch, acrossFrac: d.x / cw }
  }

  it('puts the dome at its own fraction DOWN the canvas at every width', () => {
    // The point of anchoring. One number, four very different shapes.
    for (const [cw, ch] of [[390, 844], [1000, 900], [1200, 800], [172, 230], [1600, 500]]) {
      expect(at(cw, ch).downFrac).toBeCloseTo(DOME.y, 5)
    }
  })

  it('is the fix for a laptop cropping his face off the top', () => {
    // The old rule for everybody was DY = (CH - DH) * 0.54, tuned for a 680x907 head-and-shoulders.
    // Against 784x1660 at a 1200x800 hero it put the dome 53px ABOVE the frame.
    const iw = RUDI.width, ih = RUDI.height
    const s = Math.max(1200 / iw, 800 / ih)
    const oldDy = (800 - ih * s) * 0.54
    expect(oldDy + DOME.y * ih * s).toBeLessThan(0)          // gone off the top
    expect(at(1200, 800).d.y).toBeGreaterThan(0)             // and back on the page
  })

  it('never lets the anchor pull the picture off its own edge', () => {
    // A crop that exposes the stage behind him is worse than a crop that is slightly high.
    for (const [cw, ch] of [[390, 844], [1200, 800], [172, 230], [900, 2400], [300, 2000]]) {
      const { f } = at(cw, ch)
      expect(f.dy).toBeLessThanOrEqual(0)
      expect(f.dy + f.dh).toBeGreaterThanOrEqual(ch - 0.0001)
      expect(f.dx).toBeLessThanOrEqual(0.0001)
      expect(f.dx + f.dw).toBeGreaterThanOrEqual(cw - 0.0001)
    }
  })

  it('scales the ring radius with the picture, not with the canvas', () => {
    // Two canvases of the same width but different heights crop differently; the dome is the same
    // size on the robot either way, so the rings must be too.
    const a = at(800, 900).d.r
    const b = at(800, 1200).d.r
    expect(a).toBeCloseTo(b, 5)
    expect(a).toBeCloseTo(DOME.r * RUDI.width * Math.max(800 / RUDI.width, 900 / RUDI.height), 5)
  })

  it('makes the desktop anchor a NO-OP, and that is not luck', () => {
    // The hero is 710x760 between the 236px rail and the 312px sidebar. The asset is built at that
    // aspect on purpose, so cover-fit is a 1:1 fit and the dome anchor has nothing to correct — dy
    // comes out at zero because there is no spare height to slide.
    //
    // PINNED BECAUSE IT LOOKS LIKE LUCK. If the asset's aspect ever drifts from the hero's, the crop
    // starts moving and the anchor starts doing real work, and this is the test that says why the
    // composition changed rather than leaving somebody to rediscover it from a screenshot.
    const asset = DESK.width / DESK.height
    const hero = 710 / 760
    expect(asset).toBeCloseTo(hero, 3)

    const f = coverFit(710, 760, DESK.width, DESK.height, DESK.scan!)
    expect(Math.abs(f.dy)).toBeLessThan(1)
    expect(Math.abs(f.dx)).toBeLessThan(1)
    // Nothing cropped: the drawn box is the hero box, to within a pixel.
    expect(f.dw).toBeCloseTo(710, 0)
    expect(f.dh).toBeCloseTo(760, 0)
    // And the dome lands where the asset says it does, not where the anchor would have put it.
    const d = domeInCanvas(f, DESK.width, DESK.height, DESK.scan!)
    expect(d.y / 760).toBeCloseTo(DESK.scan!.y, 3)
  })

  it('still anchors on the PHONE, where the aspects do not match', () => {
    // The same code doing real work, so the no-op above is demonstrably a property of the asset
    // rather than of the function.
    const f = coverFit(1200, 800, RUDI.width, RUDI.height, DOME)
    expect(f.dy).toBeLessThan(-1)
  })

  it('leaves the portrait crop exactly as it was for an employee with no dome', () => {
    const m = assetsFor(PERSONAS.miles, 'mobile')
    const f = coverFit(1200, 800, m.width, m.height, null)
    expect(f.dy).toBeCloseTo((800 - m.height * f.s) * 0.54, 6)
  })
})

describe('five things are drawn, and they are these five', () => {
  const rings = src.slice(src.indexOf('function drawRings'), src.indexOf('function draw(now: number)'))

  it('draws as many rings as the asset says, from one loop', () => {
    // Two sets of numbers, one drawing function — the count is data, not a constant.
    expect(rings).toMatch(/for \(let i = 0; i < SCAN\.rings; i\+\+\)/)
    expect(src).not.toMatch(/const RINGS = /)
  })

  it('and one halo, at the asset\'s own rate', () => {
    expect(rings).toMatch(/Math\.sin\(\(now \/ 1000\) \* h\.radPerS\)/)
    expect(src).not.toMatch(/const HALO_RAD_PER_S/)
    expect((rings.match(/createRadialGradient/g) ?? []).length).toBe(2)   // the ring stroke, and the halo
  })

  it('draws nothing else across him — no sweep, no mesh, no band', () => {
    const draw = src.slice(src.indexOf('function draw(now: number)'), src.indexOf('function paintGround'))
    // The sweep and the mesh still exist for the portrait loop, so the assertion is that a dome
    // persona never reaches them, not that they are gone from the file.
    expect(draw).toMatch(/if \(DOME\) drawRings\(now, scanA\)\s*\n\s*else drawSweep/)
    expect(draw).toMatch(/if \(DOME\) \{ raf = requestAnimationFrame\(draw\); return \}/)
  })

  it('stops with the rest of the scan the frame listening begins', () => {
    // One rule for both scans: scanA snaps to zero leaving idle and eases back when it returns.
    expect(rings).toMatch(/if \(!SCAN \|\| amount < 0\.02\) return/)
  })
})

describe('the phase readout', () => {
  it('is three stages and these three', () => {
    expect(SCAN_PHASES.map((p) => p[1])).toEqual(['ANALYSIS', 'READING', 'ON DUTY'])
  })
  it('names the stage the cycle is actually in', () => {
    expect(phaseAt(0)).toBe('ANALYSIS')
    expect(phaseAt(0.39)).toBe('ANALYSIS')
    expect(phaseAt(0.4)).toBe('READING')
    expect(phaseAt(0.74)).toBe('READING')
    expect(phaseAt(0.75)).toBe('ON DUTY')
    expect(phaseAt(1)).toBe('ON DUTY')
  })
})

describe('the still holds position', () => {
  it('is drawn on the same rect as the video, with no scale of its own', () => {
    // THE BUG THIS FIXES WAS ALREADY SHIPPING. The still breathed ±1% on a 3.2s cycle and the video
    // did not, so the two layers were up to 1% apart in size at the moment they cross-fade — about
    // eight pixels of vertical slide on a phone. The robot did not introduce it; it made it visible.
    const draw = src.slice(src.indexOf('function draw(now: number)'), src.indexOf('function paintGround'))
    expect(draw).toMatch(/drawImage\(img, DX, DY, DW, DH\)/)
    expect(draw).toMatch(/drawImage\(vid, DX, DY, DW, DH\)/)
    expect(src).not.toMatch(/0\.01 \* Math\.sin\(now \/ 3200\)/)
    expect(src).not.toMatch(/DW \* br/)
  })
})

describe('the canvas says who it is', () => {
  it('uses the persona name rather than the literal Rudi', () => {
    // Miles's canvas announced itself as Rudi from the day the engine learned to paint two employees.
    expect(src).toMatch(/aria-label=\{`\$\{NAME\}, /)
    expect(src).not.toMatch(/aria-label=\{`Rudi, /)
  })
})
