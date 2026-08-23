'use client'

import { useEffect, useRef } from 'react'
import { RudiCanvas, type RudiHandle } from '@/app/(v2)/v2/rudi-canvas'
import { useRudiPresence } from './rudi-presence'

// RUDI, IN THE SLOT THE ORB ALREADY HAD.
//
// The dashboard has rendered a presence here since before the robot existed: AiOrb, a waveform in a
// glass lens, inside RudiPresenceProvider, with a live Supabase subscription driving its ripple. The
// hole is already the right shape — a square that means "your employee is here" — so this is the
// robot standing in it rather than a new composition.
//
// AMBIENT, NOT THE HERO. No caption, no readouts, no composer. The full-screen treatment needs a
// quarter of empty plate under the subject for its copy, and a 144px square has none; putting the
// figures here would be the same mistake at a smaller size. What this answers is whether people
// react to him at all, which a week spent on the band would only have assumed.
//
// ── WHY IT IMPORTS ACROSS THE APP BOUNDARY ──────────────────────────────────────────────────────
//
// RudiCanvas still lives under app/(v2)/v2. That is backwards — components should not depend on a
// route tree — and it is deliberate for now: moving the engine is part of bringing the hero into the
// dashboard properly, and doing it here would make a days-long change into a wide one. When the
// engine moves to components/, this import changes by one line.

export function RudiOrb({ onClick }: { onClick?: () => void }) {
  const { eventKey } = useRudiPresence()
  const rudi = useRef<RudiHandle | null>(null)
  const seen = useRef(eventKey)

  // The orb's new-event ripple becomes his scan. Same signal, same meaning — something arrived and
  // he noticed — and the canvas already has the gesture, so nothing new is drawn for it.
  //
  // Skipped on the first render: eventKey is seeded with whatever the context is already holding, and
  // a scan on mount would say a lead had just landed every time the dashboard opened.
  useEffect(() => {
    if (eventKey === seen.current) return
    seen.current = eventKey
    rudi.current?.scan()
  }, [eventKey])

  return (
    // Both canvases are positioned here rather than by the v2 stylesheet. RudiCanvas renders the
    // readout layer as a sibling with the class `v2-cards`, whose only rule is `.v2 .v2-cards` — so
    // outside the v2 shell it has no positioning at all and would sit in normal flow, taking up a
    // second square below the portrait. It draws nothing with readouts off, but an unpositioned
    // element still occupies space.
    <div
      className="relative h-full w-full overflow-hidden rounded-full [&>canvas]:absolute [&>canvas]:inset-0 [&>canvas]:h-full [&>canvas]:w-full"
      data-rudi-orb
    >
      <RudiCanvas
        handleRef={rudi}
        readouts={false}
        persona="rudi"
        breakpoint="mobile"
        onClick={onClick}
        className="block"
      />
    </div>
  )
}
