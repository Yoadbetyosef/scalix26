'use client'

import { useState } from 'react'

// AI Summary. Display-only: on mobile it clamps to 2 lines with a "More" toggle (pure local UI
// state); on desktop (md+) it always shows the full text, exactly as before.
//
// The kit's card, not a tinted panel. v1 painted this in 6%-accent on an accent hairline, which made
// the one paragraph the AI wrote the loudest surface on a screen whose subject is what the customer
// said. The waveform survives — it is the only mark in the app that says "a machine is speaking" —
// and now carries the tint on its own, at the size of a micro-label.
export function AiSummaryCard({ summary }: { summary: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="v2-card mx-4 sm:mx-6 mt-4 flex-shrink-0 sx-animate-in" style={{ gap: 6 }}>
      <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
        <span className="flex items-end gap-[2px] h-[9px]" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="sx-wavebar w-[2px] h-full rounded-full" style={{ animationDelay: `${i * 0.15}s`, background: 'var(--v2-t1)' }} />
          ))}
        </span>
        AI Summary
      </p>
      <p className={`text-sm ${expanded ? '' : 'max-md:line-clamp-2'}`} style={{ color: 'var(--v2-ink)' }}>{summary}</p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="v2-kick md:hidden self-start min-h-[44px] inline-flex items-center"
        style={{ ['--ghue' as string]: 'var(--v2-t1)' }}
      >
        {expanded ? 'Less' : 'More'}
      </button>
    </div>
  )
}
