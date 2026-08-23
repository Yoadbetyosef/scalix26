'use client'

import { useEffect, useRef } from 'react'
import { RudiCanvas, type RudiHandle } from '../../rudi-canvas'

// Drives the CANVAS's own state, which the page probe cannot.
//
// app/(v2)/v2/render-probe forces data-state on the root, and that is enough for anything CSS keys
// off — the veil, the caption, the handle ink. It is NOT enough for anything the canvas decides for
// itself: the engine has its own state machine, reached through the handle, and forcing an attribute
// leaves it in idle. A cyan dome that only lights on rudi.listen() therefore photographed as unlit,
// which read as "the effect does not work" rather than "the probe cannot reach it".

export function CanvasProbe({ state, size }: { state: string; size: number }) {
  const rudi = useRef<RudiHandle | null>(null)

  useEffect(() => {
    const h = rudi.current
    if (!h) return
    if (state === 'listening') h.listen()
    if (state === 'armed') { h.listen(); h.arm() }
    if (state === 'speaking') h.speak('probe', 60_000)
  }, [state])

  return (
    <div
      style={{ height: size, width: size, position: 'relative', overflow: 'hidden' }}
      className="[&>canvas]:absolute [&>canvas]:inset-0 [&>canvas]:h-full [&>canvas]:w-full"
    >
      <RudiCanvas handleRef={rudi} readouts={false} persona="rudi" breakpoint="mobile" />
    </div>
  )
}
