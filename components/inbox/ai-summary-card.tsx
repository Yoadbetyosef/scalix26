'use client'

import { useState } from 'react'

// AI Summary card. Display-only: on mobile it clamps to 2 lines with a "More"
// toggle (pure local UI state); on desktop (md+) it always shows the full text,
// exactly as before. The waveform animation is preserved unchanged.
export function AiSummaryCard({ summary }: { summary: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mx-4 sm:mx-6 mt-4 p-3 sm:p-4 bg-accent/[0.06] rounded-2xl border border-accent/15 flex-shrink-0 sx-animate-in">
      <p className="text-xs font-semibold text-accent-strong mb-1 inline-flex items-center gap-1.5">
        <span className="flex items-end gap-[2px] h-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="sx-wavebar w-[2px] h-full rounded-full bg-accent" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </span>
        AI Summary
      </p>
      <p className={`text-sm text-ink ${expanded ? '' : 'max-md:line-clamp-2'}`}>{summary}</p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="md:hidden mt-1 text-xs font-semibold text-accent-strong min-h-[44px] inline-flex items-center"
      >
        {expanded ? 'Less' : 'More'}
      </button>
    </div>
  )
}
