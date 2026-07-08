'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Mic } from 'lucide-react'
import { EmployeeAvatar } from '@/components/ai-employees/employee-avatar'
import { AmyRealtime } from './amy-realtime'
import { AskAmyText } from './ask-amy-text'
import { type AmyBriefing, dataGreeting } from './ask-amy-shared'
import { useAttention } from '@/components/dashboard/attention'

export type { AmyBriefing } from './ask-amy-shared'

type Mode = 'idle' | 'live' | 'text'

/**
 * Ask Amy — talking live with your AI employee is the default. One big mic launches a
 * realtime voice conversation (Deepgram Voice Agent, same as the phone). Typing is a
 * quiet fallback. The customer phone pipeline is entirely separate.
 */
export function AskAmy({ briefing: serverBriefing }: { briefing: AmyBriefing }) {
  // The voice assistant speaks the SAME live unresolved notifications as the rest of the dashboard.
  const { ready, visibleItems } = useAttention()
  const briefing: AmyBriefing = ready
    ? { ...serverBriefing, attention: visibleItems.map((v) => ({ label: v.label, href: v.href })) }
    : serverBriefing
  const name = briefing.employeeName || 'Amy'
  const [mode, setMode] = useState<Mode>('idle')
  // The mobile action bar is fixed to the bottom of the viewport (above the tab nav). It
  // must render via a portal to <body>: the dashboard hero has a persistent transform
  // (sx-animate-in fill:both), which would otherwise make `position:fixed` resolve against
  // the hero instead of the viewport. Portal only after mount (SSR has no document.body).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
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

      {/* Mobile (B6): a large action bar FIXED to the bottom, sitting flush above the tab nav
          (Dashboard/Leads/…). Rudi's real headshot with concentric pulse rings on the left,
          and a big dark "Talk to {name}" pill filling the rest — both fire goLive. Rendered
          through a portal to <body> so `fixed` resolves to the viewport (the hero carries a
          persistent transform). Only in idle mode; the live call replaces it. */}
      {mounted &&
        createPortal(
          <div
            className="fixed inset-x-0 z-30 border-t border-hairline/70 bg-white/90 px-4 pb-3 pt-4 backdrop-blur-md md:hidden"
            style={{ bottom: 'calc(56px + env(safe-area-inset-bottom))' }}
          >
            <div className="mx-auto flex max-w-md items-center gap-3.5">
              <button
                onClick={goLive}
                aria-label={`Talk to ${name}`}
                className="relative inline-flex flex-shrink-0 items-center justify-center transition-transform active:scale-95"
              >
                <span className="sx-ring sx-ring-sm" style={{ borderColor: '#8B8DF5' }} aria-hidden="true" />
                <span className="sx-ring sx-ring-sm" style={{ borderColor: '#A5A7F7', animationDelay: '0.8s' }} aria-hidden="true" />
                <span className="sx-ring sx-ring-sm" style={{ borderColor: '#C7C9F4', animationDelay: '1.6s' }} aria-hidden="true" />
                <EmployeeAvatar name={name} voice={briefing.employeeVoice} status="on_duty" size="lg" />
              </button>
              <button
                onClick={goLive}
                className="flex h-[60px] flex-1 items-center justify-center gap-2 rounded-full bg-ink text-[17px] font-semibold text-white shadow-e2 transition-all active:scale-[0.98]"
              >
                <Mic className="h-5 w-5" />
                Talk to {name}
              </button>
            </div>
          </div>,
          document.body,
        )}

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
