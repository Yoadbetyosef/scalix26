'use client'

import { useState } from 'react'
import { useAttention } from '@/components/dashboard/attention'
import type { AmyBriefing } from './ask-amy-shared'

// The Ask Amy session — mode, the shared AudioContext, and the tap that opens a live call.
//
// ── WHY THIS IS A HOOK ──────────────────────────────────────────────────────────────────────────────
//
// `goLive` was a closure inside AskAmy. There was nothing to import: it unlocked the AudioContext and
// then flipped that component's own `mode`, which is what swaps its render to <AmyRealtime>. So "call
// AskAmy.goLive()" from another screen was not possible in the shape the code was in — /v2's Talk
// button had no function to call, which is the whole reason it was inert.
//
// Lifted here unchanged so both screens share one session machine and one audio unlock. No new voice
// layer: AmyRealtime and AskAmyText are still the only things that talk, still with the same props.
// AskAmy renders exactly as it did.

export type AmyMode = 'idle' | 'live' | 'text'

export interface AmySession {
  mode: AmyMode
  audioCtx: AudioContext | null
  goLive: () => void
  goText: () => void
  close: () => void
}

export function useAmySession(): AmySession {
  const [mode, setMode] = useState<AmyMode>('idle')
  // The parent OWNS a single, reused AudioContext for the whole Ask-Amy lifetime. It's
  // unlocked inside the user's tap (mobile autoplay policy) and shared across live
  // sessions. The realtime client only borrows it — it must never close it. We do NOT
  // proactively close it either: a remount (incl. React StrictMode's mount→unmount→mount)
  // would otherwise close it out from under an active session. One idle, suspended
  // context per page is negligible and the browser reclaims it on unload. Held in state
  // (not a ref) so it's passed to the client without reading a ref during render.
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null)

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

  return { mode, audioCtx, goLive, goText: () => setMode('text'), close: () => setMode('idle') }
}

// The live briefing. The voice assistant speaks the SAME live unresolved notifications as the rest of
// the dashboard, so the server briefing is merged with whatever attention currently says.
export function useLiveBriefing(serverBriefing: AmyBriefing): AmyBriefing {
  const { ready, visibleItems } = useAttention()
  return ready
    ? { ...serverBriefing, attention: visibleItems.map((v) => ({ label: v.label, href: v.href })) }
    : serverBriefing
}
