import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The hero, as a band in a page that scrolls.
//
// Measured on the dev server at 390 wide, in a v1 page with NO v2 stylesheet loaded: the whole robot
// in frame, both readouts in the plate below his feet, and the sentence on paper underneath in v1's
// own ink. No scrim, no backdrop, nothing over the picture — which is the point. Every contrast
// fight of the previous week existed because the sentence sat on a photograph.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const band = read('components/dashboard/hero/rudi-band.tsx')
const hero = read('components/dashboard/hero/dashboard-hero.tsx')
const canvas = read('app/(v2)/v2/rudi-canvas.tsx')

describe('the band', () => {
  it('is a clamp, because the crop closes in as the box shortens', () => {
    // coverFit anchors on the dome, so his face holds its place and the frame loses top and bottom.
    // The whole robot, feet included, survives to about 305px; 340 is the floor with room to spare.
    expect(band).toMatch(/h-\[clamp\(340px,48vh,460px\)\]/)
  })

  it('reaches both edges of a phone, and becomes a card where the page has margins', () => {
    expect(band).toMatch(/-mx-4/)
    expect(band).toMatch(/sm:-mx-0/)
    expect(band).toMatch(/sm:rounded-2xl/)
  })

  it('positions BOTH canvases itself, and lifts the readouts above the portrait', () => {
    // `.v2 .v2-cards` gives the readout layer z-index 3 and the canvas renders it BEFORE the
    // portrait. With that rule absent — and it is absent, no v2 CSS loads on a v1 page — DOM order
    // wins, the portrait paints over the readouts, and they are drawn into a layer nobody can see.
    expect(band).toMatch(/\[&>canvas\]:absolute/)
    expect(band).toMatch(/\[&>canvas:first-of-type\]:z-10/)
  })

  it('keeps the readouts, which have nothing to collide with inside the band', () => {
    expect(band).toMatch(/<RudiCanvas[\s\S]*?\breadouts\b/)
  })

  it('paints its own ground rather than reaching for a v2 token', () => {
    // --v2-stage is #0d0d10, which is exactly PERSONAS.rudi.ground — the token duplicated a value
    // the engine already carries.
    expect(band).toMatch(/bg-\[#0d0d10\]/)
    expect(band).not.toMatch(/var\(--v2-/)
  })
})

describe('the dashboard composition', () => {
  it('shows the band on mobile, where the 144px orb used to be', () => {
    expect(hero).toMatch(/<div className="md:hidden">\s*<RudiBand \/>/)
  })

  it('puts the sentence on paper under it, from the same component desktop uses', () => {
    const mobile = hero.slice(hero.indexOf('<RudiBand />'), hero.indexOf('Identity —'))
    expect(mobile).toMatch(/<AttentionSentence initial=\{stateSentence\} idleSentence=\{idleSentence\} \/>/)
    expect(mobile).toMatch(/text-ink/)
  })

  it('leaves the desktop identity row alone, orb and all', () => {
    expect(hero).toMatch(/<RudiOrb \/>/)
  })
})

describe('the cards know what to clear when there is no copy', () => {
  it('falls back to the FRAME, not to the full-screen constant', () => {
    // CEILING_FALLBACK is 0.66, chosen so cards clear a caption that has eaten the screen. Applied
    // to a band with no caption it parks both of them across the middle of the subject — which is
    // exactly what it did on the first render.
    const fn = canvas.slice(canvas.indexOf('function measureCeiling()'), canvas.indexOf('function fit()'))
    expect(fn).toMatch(/ceiling = 1 - CARD_DROP - CARD_GAP/)
    expect(fn).toMatch(/blockTopPx = CH/)
  })
})
