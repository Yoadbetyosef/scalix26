'use client'

import type { RefObject } from 'react'
import type { RudiState } from './rudi-canvas'
import { rudiState } from './rudi-line'

// PRESS TO TALK — the one control that starts and ends a live conversation.
//
// Lifted out of Composer unchanged. It was welded to that component's typing state, its magnet ref
// and its Space handling, so there was no way to give the second employee "the same button" without
// copying the markup — and a copied control drifts. Composer still renders it; the messages panel
// renders the same one.
//
// The label comes from `rudiState`, which is the canvas's own vocabulary: an employee that is
// listening says LISTENING, one that is speaking says so, and idle offers to start. Armed takes the
// SAME treatment as listening, because they are the same state — the mic is open and it is the
// caller's turn in both.

export interface TalkButtonProps {
  state: RudiState
  onTalk: () => void
  /** Composer hides it while the field is open; nothing else does. */
  hidden?: boolean
  /** Hides the keyboard hint where there is no keyboard shortcut to hint at. */
  hint?: boolean
  /** Magnetic pull, desktop only. Supplied by the shell so the physics live in one place. */
  buttonRef?: ((el: HTMLButtonElement | null) => void) | RefObject<HTMLButtonElement | null>
  /** Sits over a portrait rather than in a composer bar. Same control, different ground. */
  variant?: 'bar' | 'onPortrait'
}

const MicIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <rect x="9.5" y="2.5" width="5" height="11" rx="2.5" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4" />
  </svg>
)

/**
 * The glyph while the mic is open: a rounded square, filled.
 *
 * A microphone says what the control IS; a stop square says what pressing it DOES, and once the
 * session is running those are different sentences. Filled rather than stroked because it is the one
 * solid shape on a surface that has otherwise gone quiet — see option D.
 */
const StopIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" stroke="none" />
  </svg>
)

export function TalkButton({ state, onTalk, hidden, hint = true, buttonRef, variant = 'bar' }: TalkButtonProps) {
  return (
    <button
      ref={buttonRef as RefObject<HTMLButtonElement | null>}
      type="button"
      className="v2-ctl v2-talk"
      data-variant={variant === 'onPortrait' ? 'portrait' : undefined}
      data-on={state !== 'idle' || undefined}
      data-hidden={hidden || undefined}
      data-touch
      onClick={onTalk}
      aria-hidden={hidden}
      tabIndex={hidden ? -1 : 0}
    >
      <span className="v2-mic">{state === 'idle' ? <MicIcon /> : <StopIcon />}</span>
      {/* "Stop" while she is hearing or answering, because that is what the press does. ARMED keeps
          its own word: rudi-line.ts records why — nothing is running to stop, it is waiting for you,
          and that decision predates this screen. */}
      <span className="v2-lab">{state === 'listening' || state === 'speaking' ? 'Stop' : rudiState(state)}</span>
      {hint && <span className="v2-kbd">{state === 'idle' ? 'SPACE' : 'END'}</span>}
      <span className="v2-shine" aria-hidden><i /></span>
    </button>
  )
}
