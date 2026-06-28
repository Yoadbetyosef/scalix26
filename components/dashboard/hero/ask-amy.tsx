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

  if (mode === 'live') return <AmyRealtime briefing={briefing} onClose={() => setMode('idle')} onType={() => setMode('text')} />
  if (mode === 'text') return <AskAmyText briefing={briefing} onTalk={() => setMode('live')} />

  return (
    <div className="mx-auto w-full max-w-md text-center">
      <p className="mb-5 text-[15px] font-light text-subtle">{dataGreeting(briefing)} Tap to talk to {name}.</p>
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={() => setMode('live')}
          aria-label={`Talk to ${name}`}
          className="relative flex h-20 w-20 items-center justify-center rounded-full bg-ink text-white shadow-e3 transition-all hover:-translate-y-0.5 hover:shadow-e4 active:scale-95"
        >
          <span aria-hidden="true" className="absolute -inset-1.5 rounded-full bg-accent/25 sx-halo" />
          <Mic className="relative h-7 w-7" />
        </button>
        <button onClick={() => setMode('text')} className="text-xs font-medium text-muted hover:text-ink transition-colors">
          Type instead
        </button>
      </div>
    </div>
  )
}
