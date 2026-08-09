'use client'

import { useState } from 'react'
import type { RudiState } from './rudi-canvas'
import { rudiState } from './rudi-line'

// One control that switches between voice and typing.
//
// The reference treats these as two faces of a single control rather than two controls: the Talk
// button and the text field occupy the same slot, and a small mic glyph inside the field switches
// back. That is why this is one component with a mode, not a button beside an input.
//
// READ-ONLY. Send is rendered because the layout is dishonest without it, and disabled because /v2
// writes nothing.

const MicIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <rect x="9.5" y="2.5" width="5" height="11" rx="2.5" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4" />
  </svg>
)

interface Props {
  state: RudiState
  onTalk: () => void
  /** Mobile stretches the control to the full width of the sticky bar. */
  full?: boolean
}

export function Composer({ state, onTalk, full = false }: Props) {
  const [typing, setTyping] = useState(false)
  const [value, setValue] = useState('')

  if (typing) {
    return (
      <div className="v2-composer">
        <div className="v2-tin" style={full ? { maxWidth: 'none' } : undefined}>
          <button
            type="button"
            className="v2-mtog"
            onClick={() => setTyping(false)}
            title="Switch to voice"
            aria-label="Switch to voice"
            style={{ display: 'flex', flex: 'none' }}
          >
            <MicIcon />
          </button>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Type to Rudi…"
            autoComplete="off"
            aria-label="Type to Rudi"
          />
          <button type="button" className="v2-send" disabled title="v2 preview" aria-label="Send">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M5 12h13M13 6l6 6-6 6" /></svg>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="v2-composer" style={full ? undefined : { display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        type="button"
        className="v2-talk"
        data-on={state !== 'idle'}
        onClick={onTalk}
        style={full ? { width: '100%', justifyContent: 'center' } : undefined}
      >
        <MicIcon />
        <span>{rudiState(state)}</span>
        {!full && <span className="v2-kbd">SPACE</span>}
      </button>
      {!full && (
        <button
          type="button"
          onClick={() => setTyping(true)}
          title="Switch to typing"
          aria-label="Switch to typing"
          className="v2-mono"
          style={{ color: 'rgba(255,255,255,.45)', padding: '8px 4px' }}
        >
          Type
        </button>
      )}
    </div>
  )
}
