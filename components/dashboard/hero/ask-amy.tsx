'use client'

import { useState } from 'react'
import { Mic } from 'lucide-react'
import { EmployeeAvatar } from '@/components/ai-employees/employee-avatar'
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

      {/* Mobile (B6): the bottom action row — Rudi's avatar (real headshot) with concentric
          pulse rings on the left, and a large dark "Talk to {name}" pill filling the rest.
          Both fire goLive (the live call). Pushed lower (mt-6) so it sits close to the tab
          bar. "Type instead" stays reachable as a quiet link below. */}
      <div className="mt-6 md:hidden">
        <div className="flex items-center gap-3.5">
          <button
            onClick={goLive}
            aria-label={`Talk to ${name}`}
            className="relative inline-flex flex-shrink-0 items-center justify-center transition-transform active:scale-95"
          >
            <span className="sx-ring" style={{ borderColor: '#8B8DF5' }} aria-hidden="true" />
            <span className="sx-ring" style={{ borderColor: '#A5A7F7', animationDelay: '0.8s' }} aria-hidden="true" />
            <span className="sx-ring" style={{ borderColor: '#C7C9F4', animationDelay: '1.6s' }} aria-hidden="true" />
            <EmployeeAvatar name={name} voice={briefing.employeeVoice} status="on_duty" size="lg" />
          </button>
          <button
            onClick={goLive}
            className="flex h-[60px] flex-1 items-center justify-center gap-2.5 rounded-full bg-ink text-[17px] font-semibold text-white shadow-e2 transition-all active:scale-[0.98]"
          >
            <Mic className="h-[22px] w-[22px]" />
            Talk to {name}
          </button>
        </div>
        <button
          onClick={() => setMode('text')}
          className="mt-3 block w-full text-center text-sm font-medium text-muted transition-colors active:text-ink"
        >
          Type instead
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
