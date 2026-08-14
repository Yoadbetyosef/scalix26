'use client'

import { useRef, useState } from 'react'

// TAKE OVER, THEN REPLY — one block that becomes the other.
//
// ── NEVER SHOW A COMPOSER THAT CANNOT SEND ──────────────────────────────────────────────────────────
//
// The swap is the design: tapping "Take over and reply" replaces the button and its line with a field
// and focuses it, because taking over and then hunting for where to type is two steps for one
// intention. But a composer that cannot deliver is a promise the screen does not keep, so the swap is
// gated on `canSend` — and in the /v2 preview, where every action is disabled, the button stays a
// button. The interaction is here in full; what it waits on is a real sender, not more design.

export function TakeOver({
  agentName,
  canSend,
  disabledReason,
}: {
  agentName: string
  /** False in the preview: the button renders, disabled, and never swaps. */
  canSend: boolean
  disabledReason?: string
}) {
  const [live, setLive] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  if (!live) {
    return (
      <div className="v2-cmp">
        <button
          type="button"
          className="v2-takeover"
          data-touch
          disabled={!canSend}
          title={canSend ? undefined : disabledReason}
          onClick={() => {
            if (!canSend) return
            setLive(true)
            // Focused on the next frame: the field does not exist until this render commits.
            requestAnimationFrame(() => input.current?.focus())
          }}
        >
          Take over and reply
        </button>
        <p className="v2-tosub">{agentName} stops answering this thread.</p>
      </div>
    )
  }

  return (
    <div className="v2-cmp" data-live>
      <div className="v2-live">
        <input ref={input} placeholder={`Reply to this conversation…`} aria-label="Your reply" />
        <button type="button" className="v2-snd" aria-label="Send">↑</button>
      </div>
    </div>
  )
}
