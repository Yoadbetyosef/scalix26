import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { coverFit, domeInCanvas, phaseAt, SCAN_PHASES } from './rudi-canvas'
import { PERSONAS } from '@/lib/persona'

// Rudi is a robot. The scan is four rings leaving the dome of his face and a halo on the glass —
// five things drawn, and nothing else. Everything the portrait loop drew ACROSS a face is gone.

const src = readFileSync(join(process.cwd(), 'app/(v2)/v2/rudi-canvas.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

const RUDI = PERSONAS.rudi
const DOME = RUDI.dome!

describe('the three numbers the whole thing rests on', () => {
  // Measured off the dome INCLUDING its rim, which is what the rings sit outside of. A measurement of
  // the dark glass core alone comes out at 0.672 / 0.336 / 0.096 — inside this in every direction.
  it('pins the dome to the plate it was measured off', () => {
    expect(DOME).toEqual({ x: 0.684, y: 0.349, r: 0.108 })
  })

  it('pins the source the fractions are fractions OF', () => {
    // A fraction is meaningless without the frame it divides. Both media are this size, and both were
    // extracted byte-identically so neither has been re-encoded away from it.
    expect([RUDI.width, RUDI.height]).toEqual([784, 1660])
    expect(RUDI.still).toBe('/v2/rudi-robot-still.jpg')
    expect(RUDI.video).toBe('/v2/rudi-robot-speaking.mp4')
  })

  it('leaves Miles on his own dimensions and his own loop', () => {
    expect([PERSONAS.miles.width, PERSONAS.miles.height]).toEqual([680, 907])
    // No dome, so the engine gives him the sweep and the mesh he already had. He will need a
    // character from the same family eventually; it is not derived from a robot arm.
    expect(PERSONAS.miles.dome).toBeUndefined()
    expect(PERSONAS.miles.nodes).toBe('/v2/miles-nodes.json')
  })

  it('takes the mesh away from the robot, because nothing is drawn across the machine', () => {
    expect(RUDI.nodes).toBeNull()
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

  it('leaves the portrait crop exactly as it was for an employee with no dome', () => {
    const m = PERSONAS.miles
    const f = coverFit(1200, 800, m.width, m.height, null)
    expect(f.dy).toBeCloseTo((800 - m.height * f.s) * 0.54, 6)
  })
})

describe('five things are drawn, and they are these five', () => {
  const rings = src.slice(src.indexOf('function drawRings'), src.indexOf('function draw(now: number)'))

  it('draws four rings', () => {
    expect(src).toMatch(/const RINGS = 4/)
    expect(rings).toMatch(/for \(let i = 0; i < RINGS; i\+\+\)/)
  })

  it('and one halo, breathing at the rate the prototype actually uses', () => {
    // 4.4s cycle, sin(t * 10) — which is 10/4.4 rad/s. Stated as a rate so it survives the cycle
    // length changing, and taken from the file rather than from the brief's description of it.
    expect(src).toMatch(/const HALO_RAD_PER_S = 10 \/ 4\.4/)
    expect(rings).toMatch(/Math\.sin\(\(now \/ 1000\) \* HALO_RAD_PER_S\)/)
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
    expect(rings).toMatch(/if \(!DOME \|\| amount < 0\.02\) return/)
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
