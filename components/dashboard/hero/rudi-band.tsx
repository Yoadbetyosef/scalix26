'use client'

import { useRef } from 'react'
import { RudiCanvas, type RudiHandle } from '@/app/(v2)/v2/rudi-canvas'
import { usePresenceScan } from './use-presence-scan'

// THE HERO, AS A BAND IN A PAGE THAT SCROLLS.
//
// /v2 gives the robot the whole viewport: he takes the top two thirds and the copy gets a quarter of
// empty plate underneath. A dashboard scrolls and cannot spare a screen, so the band keeps the
// picture and gives the copy away — the sentence moves to paper below, as v1's AttentionSentence,
// and that single move is what makes this straightforward. Every contrast fight of the last week
// existed because the sentence sat on a photograph.
//
// ── WHY THE HEIGHT IS A CLAMP ───────────────────────────────────────────────────────────────────
//
// coverFit anchors the crop on the dome, so as the box gets shorter the frame closes in from top and
// bottom while his face holds its place. Computed against the shipped function at 390px wide: the
// whole robot, feet included, survives down to about 305px and is cropped below that. 340 is the
// floor with room to spare; 460 is where he stops gaining and the band starts eating the page.
//
// ── AND WHY IT CARRIES NO v2 CSS ────────────────────────────────────────────────────────────────
//
// None is loaded here — v2-tokens.css is imported by the (v2) layout and nothing else. The canvas
// renders two elements, classed `v2-face` and `v2-cards`, whose rules are simply absent on a v1
// page; the child utilities below position both, and outrank those rules anyway where they do exist.
// The one value that might have been wanted, --v2-stage, is #0d0d10 — the same colour the persona
// record already carries as Rudi's ground, so the token was a duplicate of something the engine
// knows about itself.
//
// The z-index is not decoration. `.v2 .v2-cards` gives the readout layer z-index 3, and the canvas
// renders it BEFORE the portrait — so with that rule absent, DOM order wins, the portrait paints over
// the readouts and they are drawn perfectly into a layer nobody can see. `canvas:first-of-type` is
// the readout layer; the portrait is the second one.

export function RudiBand({ onClick }: { onClick?: () => void }) {
  const rudi = useRef<RudiHandle | null>(null)
  usePresenceScan(rudi)

  return (
    // Full-bleed on a phone — the page's own p-4 is cancelled so the picture reaches both edges,
    // which is the whole reason it reads as a hero rather than as an illustration in a card. It
    // becomes a rounded card from sm: up, where the page has margins to respect.
    <div
      className="relative -mx-4 h-[clamp(340px,48vh,460px)] overflow-hidden bg-[#0d0d10] sm:-mx-0 sm:rounded-2xl [&>canvas]:absolute [&>canvas]:inset-0 [&>canvas]:h-full [&>canvas]:w-full [&>canvas:first-of-type]:z-10"
      data-rudi-band
    >
      {/* The acid readouts stay with him: they are drawn on the picture, they are placed off the
          subject's own floor, and there is no copy inside the band for them to collide with. */}
      <RudiCanvas handleRef={rudi} readouts persona="rudi" breakpoint="mobile" onClick={onClick} />
    </div>
  )
}
