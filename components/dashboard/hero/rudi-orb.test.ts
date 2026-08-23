import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Rudi standing in the slot AiOrb already had. Ambient, not the hero.
//
// Geometry, from the shipped coverFit/domeInCanvas at each size the dashboard renders:
//
//   144px (mobile centrepiece)   his face 31px across, feet in frame
//   112px (desktop sm:)          his face 24px across, feet in frame
//    96px (desktop base)         his face 21px across, feet in frame
//
// The face is 22% of the disc at every size — both scale with width — and in a SQUARE box the dome
// anchoring keeps his feet inside the frame at any size, which the full-height hero does not manage
// below about 305px. Small enough that the expression does not read at 96px; the silhouette and the
// lit eyes do.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const orb = read('components/dashboard/hero/rudi-orb.tsx')

describe('the orb is the engine, ambient', () => {
  it('draws no readouts — a 144px square has no room for the figures', () => {
    expect(orb).toMatch(/readouts=\{false\}/)
  })

  it('positions both canvases itself, because the v2 stylesheet will not', () => {
    // RudiCanvas renders the readout layer as a sibling with the class `v2-cards`, whose only rule is
    // `.v2 .v2-cards`. Outside the v2 shell it has NO positioning, so it would sit in normal flow and
    // take a second square below the portrait — it draws nothing with readouts off, but an
    // unpositioned element still occupies space.
    expect(orb).toMatch(/\[&>canvas\]:absolute/)
    expect(orb).toMatch(/\[&>canvas\]:inset-0/)
  })

  it('turns the presence ripple into his scan, using the gesture the canvas already has', () => {
    expect(orb).toMatch(/useRudiPresence\(\)/)
    expect(orb).toMatch(/rudi\.current\?\.scan\(\)/)
  })

  it('does not scan on mount, which would claim a lead had just arrived', () => {
    // eventKey is seeded from whatever the context already holds, so the first render must be a
    // no-op rather than a notification every time the dashboard opens.
    expect(orb).toMatch(/const seen = useRef\(eventKey\)/)
    expect(orb).toMatch(/if \(eventKey === seen\.current\) return/)
  })

  it('paints the robot, at the asset the hero uses', () => {
    expect(orb).toMatch(/persona="rudi"/)
    expect(orb).toMatch(/breakpoint="mobile"/)
  })
})
