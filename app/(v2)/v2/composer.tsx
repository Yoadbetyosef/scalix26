'use client'

import { useEffect, useRef, useState } from 'react'
import type { RudiState } from './rudi-canvas'
import { TalkButton } from './talk-button'

// ONE control, not two.
//
// The first version put a separate "TYPE" label beside the pill, which made typing a second control
// competing with the first. The reference has no such affordance: the pill and the field are the same
// object in two states. Same position, same height, same radius — the fill becomes a 1.5px gradient
// border and the label becomes a caret. Nothing moves.
//
// Entering text mode: type any letter, or "/", anywhere on the page. Leaving it: Esc, or the mic glyph
// on the left. Enter sends.
//
// READ-ONLY: send is rendered because the control is dishonest without it, and disabled because /v2
// writes nothing.

const MicIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <rect x="9.5" y="2.5" width="5" height="11" rx="2.5" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4" />
  </svg>
)

export interface ComposerProps {
  state: RudiState
  /** The employee's own name, for the button's label. */
  name?: string
  onTalk: () => void
  /** Mobile stretches the control across the sticky bar. */
  full?: boolean
  /** What the owner typed, echoed above the caption as one mono line. */
  onSubmit?: (text: string) => void
  /** Lifted so the shell can suppress the Space shortcut while typing. */
  onTypingChange?: (typing: boolean) => void
  /** Magnetic pull, desktop only. Supplied by the shell so the physics live in one place. */
  buttonRef?: (el: HTMLButtonElement | null) => void
}

export function Composer({ state, onTalk, full = false, onSubmit, onTypingChange, buttonRef, name }: ComposerProps) {
  const [typing, setTyping] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { onTypingChange?.(typing) }, [typing, onTypingChange])

  // Any letter, digit or "/" opens the field and lands in it. The reference's behaviour: you start
  // typing and the control is already there, rather than reaching for a control first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const printable = e.key.length === 1 && /[\w/]/.test(e.key)
      if (!printable) return
      e.preventDefault()
      setTyping(true)
      setValue(e.key === '/' ? '' : e.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [typing])

  useEffect(() => { if (typing) inputRef.current?.focus() }, [typing])

  const leave = () => { setTyping(false); setValue('') }

  const submit = () => {
    const text = value.trim()
    if (!text) { leave(); return }
    onSubmit?.(text)
    setValue('')
    // Stays in text mode after sending — the reference keeps the field open so a second line follows
    // the first without reaching for the control again.
  }

  return (
    <div className="v2-composer" data-full={full || undefined}>
      {/* Both faces share .v2-ctl, which owns the geometry. Only the skin differs.
          The button itself lives in talk-button.tsx now: the messages panel renders the SAME control,
          and a copied one would drift the moment either screen changed. */}
      <TalkButton
        name={name}
        state={state}
        onTalk={onTalk}
        hidden={typing}
        hint={!full}
        buttonRef={buttonRef}
      />

      <div className="v2-ctl v2-tin" data-hidden={!typing || undefined}>
        <button
          type="button"
          className="v2-mic v2-mic-btn"
          onClick={leave}
          title="Switch to voice"
          aria-label="Switch to voice"
          tabIndex={typing ? 0 : -1}
        >
          <MicIcon />
        </button>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit() }
            if (e.key === 'Escape') { e.preventDefault(); leave() }
          }}
          placeholder="Type to Rudi…"
          autoComplete="off"
          aria-label="Type to Rudi"
          tabIndex={typing ? 0 : -1}
        />
        <button
          type="button"
          className="v2-send"
          disabled
          title="v2 preview"
          aria-label="Send"
          tabIndex={-1}
        >
          <svg viewBox="0 0 24 24" aria-hidden><path d="M5 12h13M13 6l6 6-6 6" /></svg>
        </button>
      </div>
    </div>
  )
}
