'use client'

import { useState } from 'react'
import { Mic } from 'lucide-react'
import { AmyRealtime } from './amy-realtime'
import { AskAmyText } from './ask-amy-text'
import { type AmyBriefing, dataGreeting } from './ask-amy-shared'

export type { AmyBriefing } from './ask-amy-shared'

type Mode = 'idle' | 'live' | 'text'

/**
 * Ask Amy — talking live with your AI employee is the default. One big mic launches a
 * realtime voice conversation (Deepgram Voice Agent, same as the phone). Typing is a
 * quiet fallback. The customer phone pipeline is entirely separate.
 */
export function AskAmy({ briefing }: { briefing: AmyBriefing }) {
  const name = briefing.employeeName || 'Amy'
  const [mode, setMode] = useState<Mode>('idle')
  // The parent OWNS a single, reused AudioContext for the whole Ask-Amy lifetime. It's
  // unlocked inside the user's tap (mobile autoplay policy) and shared across live
  // sessions. The realtime client only borrows it — it must never close it. We do NOT
  // proactively close it either: a remount (incl. React StrictMode's mount→unmount→mount)
  // would otherwise close it out from under an active session. One idle, suspended
  // context per page is negligible and the browser reclaims it on unload. Held in state
  // (not a ref) so it's passed to the client without reading a ref during render.
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null)

  // Unlock/resume audio output synchronously INSIDE the tap. iOS Safari + Android Chrome
  // only let an AudioContext start (and play sound) from a user gesture; the realtime
  // client mounts a tick later, by which point the gesture is gone.
  const goLive = () => {
    try {
      let ctx = audioCtx
      if (!ctx || ctx.state === 'closed') {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        ctx = new Ctor()
        setAudioCtx(ctx)
      }
      ctx.resume().catch(() => {})
      // A 1-sample silent buffer played in-gesture fully unlocks output on iOS.
      const unlock = ctx.createBufferSource()
      unlock.buffer = ctx.createBuffer(1, 1, 22050)
      unlock.connect(ctx.destination)
      unlock.start(0)
    } catch {
      /* fall back to the client creating its own context */
    }
    setMode('live')
  }

  if (mode === 'live') return <AmyRealtime briefing={briefing} audioCtx={audioCtx} onClose={() => setMode('idle')} onType={() => setMode('text')} />
  if (mode === 'text') return <AskAmyText briefing={briefing} onTalk={goLive} />

  return (
    <div className="mx-auto w-full max-w-md text-center">
      <p className="mb-5 text-[15px] font-light text-subtle max-md:hidden">{dataGreeting(briefing)} Tap to talk to {name}.</p>

      {/* Mobile: an input-like pill. Tapping the text area opens typing (same handler as
          "Type instead"); the round mic launches the live call (same goLive handler). */}
      <div className="flex items-center gap-2 rounded-full border border-hairline-strong bg-white p-1.5 pl-4 shadow-e1 md:hidden">
        <button
          onClick={() => setMode('text')}
          className="min-h-[44px] flex-1 truncate text-left text-[15px] text-muted"
        >
          Ask {name} anything…
        </button>
        <button
          onClick={goLive}
          aria-label={`Talk to ${name}`}
          className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-ink text-white shadow-e2 transition-all active:scale-95"
        >
          <span aria-hidden="true" className="pointer-events-none absolute -inset-1 rounded-full bg-accent/25 sx-halo" />
          <Mic className="pointer-events-none relative h-5 w-5" />
        </button>
      </div>

      {/* Desktop: the original large mic button — unchanged. */}
      <div className="hidden flex-col items-center gap-4 md:flex">
        <button
          onClick={goLive}
          aria-label={`Talk to ${name}`}
          className="relative flex h-20 w-20 items-center justify-center rounded-full bg-ink text-white shadow-e3 transition-all hover:-translate-y-0.5 hover:shadow-e4 active:scale-95"
        >
          {/* Decorative breathing halo — must never intercept pointer events, or it
              overlaps and steals taps from the "Type instead" button below it. */}
          <span aria-hidden="true" className="pointer-events-none absolute -inset-1.5 rounded-full bg-accent/25 sx-halo" />
          <Mic className="pointer-events-none relative h-7 w-7" />
        </button>
        <button onClick={() => setMode('text')} className="text-xs font-medium text-muted transition-colors hover:text-ink">
          Type instead
        </button>
      </div>
    </div>
  )
}
