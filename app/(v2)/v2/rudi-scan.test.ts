import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { PERSONAS } from '@/lib/persona'

// THE SCAN, AGAINST ITS REFERENCE.
//
// docs/miles/rudi-scan-v26.html is the approved resting state, and every number in the component was
// copied from it rather than re-derived. So the test that matters is not "does it draw something" —
// it is "are these still the reference's numbers". A constant that drifts here is a screen that
// stopped being the thing that was approved, and nothing else would catch it.
//
// Read as TEXT on both sides on purpose. The reference is a standalone HTML file with no exports and
// the component is a client module with none of these values exposed; pinning the source strings is
// what makes the two comparable at all, and it is the same shape bills.test.ts uses against its own
// reference.

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

const ref = read('../../../docs/miles/rudi-scan-v26.html')
const scan = read('./rudi-scan.tsx')
const body = strip(scan)
const css = read('./v2-tokens.css')
const legacy = read('./rudi-canvas.tsx')

/** The reference writes numbers bare; the component writes them with a leading zero. */
const both = (refStr: string, tsStr: string, label: string) => {
  expect(ref, `reference: ${label}`).toContain(refStr)
  expect(body, `component: ${label}`).toContain(tsStr)
}

describe('the sequence is the reference’s, number for number', () => {
  it('the two clocks, which are deliberately not the same', () => {
    // 5.4 against 5.25 — the readouts drift against the scan instead of arriving with it.
    both('const CYCLE=5.4, CARD_CYCLE=5.25', 'const CYCLE = 5.4', 'cycle')
    expect(body).toContain('const CARD_CYCLE = 5.25')
  })

  it('the ceiling that keeps the readouts off the copy — as a FALLBACK', () => {
    // The reference's 0.660 was measured against one sentence at one width. It survives as the value
    // used when there is nothing to measure, not as the rule.
    both('const CEILING=.660', 'const CEILING_FALLBACK = 0.66', 'ceiling')
  })

  it('and the real ceiling is measured from the block it has to clear', () => {
    // A fixed fraction put CALLS TODAY on top of the sentence the moment the caption wrapped to two
    // lines, which it does on a narrow phone.
    expect(body).toContain("querySelector('[data-bottom-block]')")
    expect(read('./home-client.tsx')).toContain('<div className="v2-overlay" data-bottom-block>')
    expect(body).toContain('const want = top - CARD_DROP - CARD_GAP')
  })

  it('the LOWER card is the one that has to clear it', () => {
    // A ceiling computed without the drop leaves exactly one of the two overlapping, which is the
    // half-fixed version of the bug and harder to see than the whole one.
    expect(body).toContain('const CARD_DROP = 0.055')
    expect(body).toContain('const drop = i === 1 ? H * CARD_DROP : 0')
  })

  it('measured on layout, never per frame', () => {
    // getBoundingClientRect is a layout read; sixty a second to answer a question that changes when
    // the text wraps is what makes a canvas feel expensive.
    expect(body).toContain('const bro = block ? new ResizeObserver(() => measureCeiling()) : null')
    // Bounded to the frame function itself — everything after it is setup, and the setup is exactly
    // where these two calls belong.
    const from = body.indexOf('function frame()')
    const loop = body.slice(from, body.indexOf('if (!reduced) {', from))
    expect(loop).not.toContain('measureCeiling()')
    expect(loop).not.toContain('getBoundingClientRect')
    expect(loop).not.toContain('fit()')
  })

  it('and the whole bottom block moves as ONE number', () => {
    // The sentence, the button, the handle and SWIPE UP are two elements pinned at two offsets, and
    // the spacing between them IS the difference between those offsets.
    expect(css).toContain('.v2 { --v2-bottom-drop: 56px; }')
    expect(css).toContain('padding: 0 16px calc(132px - var(--v2-bottom-drop) + env(safe-area-inset-bottom));')
    expect(css).toContain('.v2 .v2-grab { bottom: calc(92px - var(--v2-bottom-drop)); }')
  })

  it('the card envelope: ~0.45s in, 3.4s hold, ~1.15s out', () => {
    for (const [r, t] of [['local<.09', 'local < 0.09'], ['local<.77', 'local < 0.77'], ['(local-.77)/.23', '(local - 0.77) / 0.23']]) {
      both(r, t, r)
    }
  })

  it('the box opens on the same easing over the same window', () => {
    both('eo(seg(.04,.24))', 'eo(seg(0.04, 0.24))', 'open')
    both('k=>1-Math.pow(1-k,3)', '(k: number) => 1 - Math.pow(1 - k, 3)', 'ease-out cubic')
  })

  it('the tick ring is a true circle of 96, half a turn per cycle', () => {
    both('const TICKS=96', 'const TICKS = 96', 'tick count')
    both('RAD=W*.52', 'RAD = W * 0.52', 'radius')
    both('t*Math.PI*2*0.5', 't * Math.PI * 2 * 0.5', 'spin')
    both('hy=H*.355', 'hy = H * 0.355', 'head centre')
    // Acid, and the only acid in the sequence apart from the readouts.
    both('rgba(217,242,36,', 'rgba(217,242,36,', 'acid')
  })

  it('the wireframe is warped rather than spherical', () => {
    both('Math.sqrt(Math.max(0,1-v*v*.40))', 'Math.sqrt(Math.max(0, 1 - v * v * 0.40))', 'lean')
    both('COLS=16,ROWS=22', 'COLS = 16, ROWS = 22', 'grid')
  })

  it('the square grid carries the ramp horizontally', () => {
    both('255-221*gx', '255 - 221 * gx', 'red ramp')
    both('46+165*gx', '46 + 165 * gx', 'green ramp')
    both('147+91*gx', '147 + 91 * gx', 'blue ramp')
  })

  it('and the ramp itself is untouched by the rebuild', () => {
    expect(PERSONAS.rudi.ramp).toEqual(['#22D3EE', '#8B5CF6', '#FF2E93'])
  })

  it('the markers, the heat and the phases are the same lists', () => {
    expect((ref.match(/[VCA]·\d\d\d/g) ?? []).length).toBe(8)
    expect((scan.match(/[VCA]·\d\d\d/g) ?? []).length).toBe(8)
    for (const phase of ['ANALYSIS', 'READING', 'THE INBOX', 'THE DIARY', 'ON DUTY']) {
      expect(ref, phase).toContain(phase)
      expect(scan, phase).toContain(phase)
    }
    for (const card of ['CALLS TODAY', 'WAITING ON YOU', 'AFTER HOURS', 'AVG CALL']) {
      expect(scan, card).toContain(card)
    }
  })

  it('the scan is erased out of the lower band rather than being left to the veil', () => {
    // A pale grid line survives a 55%-black gradient as a stripe across the copy.
    both("globalCompositeOperation='destination-out'", "globalCompositeOperation = 'destination-out'", 'erase')
    both('H*.50,0,H*.74', 'H * 0.50, 0, H * 0.74', 'erase band')
  })
})

describe('the portrait left the canvas', () => {
  it('nothing draws the still any more — the browser composites it', () => {
    // The old loop's drawImage of the portrait, its breath and its video sampling are all gone here.
    expect(body).not.toMatch(/drawImage/)
    expect(scan).toContain('<img className="v2-scan-portrait"')
    expect(css).toContain('object-fit: cover; object-position: center 20%;')
  })

  it('and the assets are the frame’s ratio, not the legacy loop’s', () => {
    // 784×1660 = 0.4723, which is the phone frame itself, so cover neither crops nor letterboxes.
    // The legacy loop hardcodes 680×907 and draws the portrait ITSELF, so the two are not
    // interchangeable — see OUTSTANDING §11d.
    expect(legacy).toContain('const IW = 680')
    expect(legacy).toContain('const IH = 907')
    expect(strip(scan)).not.toMatch(/\b680\b|\b907\b/)
  })

  it('the speaking clip sits ON the still rather than replacing it', () => {
    // A fade between two elements in one box cannot show a gap, and if the bytes never arrive the
    // still is simply still there.
    expect(scan).toContain('style={{ opacity: speaking ? 1 : 0 }}')
    expect(css).toContain('.v2 video.v2-scan-portrait { transition: opacity 0.28s var(--v2-ease); }')
  })
})

describe('a scan is what she does while waiting', () => {
  it('speaking stops it, and the clock keeps running underneath', () => {
    // So it resumes mid-stride rather than restarting at the centre line.
    expect(body).toContain("const wanted = stateRef.current === 'speaking' ? 0 : 1")
    expect(body).toContain('t = (t + dt / CYCLE) % 1')
    expect(body.indexOf('const wanted')).toBeLessThan(body.indexOf('t = (t + dt / CYCLE)'))
  })

  it('it is a fade, not a cut', () => {
    expect(body).toContain('scanA += (wanted - scanA) * Math.min(1, dt * 8)')
  })

  it('and the phase readout goes quiet with it', () => {
    // It names a phase of the sequence; with no sequence running it would be naming nothing.
    expect(scan).toContain('data-quiet={speaking || undefined}')
    expect(css).toContain('.v2 .v2-scan-phase[data-quiet] { opacity: 0; }')
  })

  it('the readout is written only when it CHANGES', () => {
    // A text node touched every frame is a layout invalidation sixty times a second for a string
    // that changes five times a cycle.
    expect(body).toContain('if (phaseKey !== ph[1])')
  })

  it('reduced motion gets the portrait and nothing else', () => {
    // The whole sequence is motion; there is no slower version of it that is still the thing.
    expect(body).toContain('if (!reduced) {')
  })
})

describe('Miles waits, and the wait is written down', () => {
  it('he is on the old loop because there is no reference for him', () => {
    expect(legacy).toContain("const SCAN_PERSONAS = new Set<PersonaKey>(['rudi'])")
    expect(legacy).toContain('THAT IS A WAIT RATHER THAN A DESIGN DECISION')
  })

  it('so his mesh is live code, and hers is gone', () => {
    expect(existsSync(new URL('../../../public/v2/miles-nodes.json', import.meta.url))).toBe(true)
    expect(existsSync(new URL('../../../public/v2/rudi-nodes.json', import.meta.url))).toBe(false)
    expect(PERSONAS.rudi.nodes).toBeNull()
    expect(PERSONAS.miles.nodes).toBe('/v2/miles-nodes.json')
  })

  it('and the generator survives even though the scan made it unnecessary for her', () => {
    // It is the only way his could ever be regenerated, and the next portrait swap on the legacy
    // loop hits exactly the wall that forced it to be written.
    expect(existsSync(new URL('../../../scripts/build-portrait-nodes.mjs', import.meta.url))).toBe(true)
    expect(read('../../../lib/invoices/OUTSTANDING.md')).toContain('§11 — The node meshes')
  })
})
