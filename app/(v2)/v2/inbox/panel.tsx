'use client'

import { useEffect, useRef } from 'react'
import { RudiCanvas, type RudiHandle } from '../rudi-canvas'
import { useIsMobile } from '../use-breakpoint'
import { useVoiceLevels } from './use-levels'
import { useTestAi } from '@/lib/test-ai/use-test-ai'

// MILES, AT THE TOP OF HIS OWN SCREEN.
//
// A hero panel, not a floating button: he is an employee, not a help widget. Portrait, ON DUTY, one
// line about what happened, and a mic — and the mic is the point. Typing is the fallback.
//
// ── THE SAME ENGINE, A DIFFERENT RECORD ─────────────────────────────────────────────────────────────
//
// The canvas is Rudi's canvas with `persona="miles"`. Portrait, speaking loop, mesh, stage and ramp
// all come from lib/persona; the scan sweep, the meter, the crossfade and the state machine are
// literally the same code. That was the point of making the persona data.
//
// ── ONE STATE MACHINE ───────────────────────────────────────────────────────────────────────────────
//
// useTestAi owns the turn-taking, the recognition lifecycle and the audio teardown. This does not
// re-implement any of it; it PROJECTS the three booleans it already exposes onto the canvas handle.
// A second machine would be a second set of the bugs that one took a long time to stop having.

interface Props {
  /** Miles's own agent row. The sandbox machine answers as whoever this is. */
  agentId: string
  agentName: string
  /** What actually happened. Every one of these is a count of real rows. */
  sent: number
  waiting: number
  needs: number
}

const Mic = () => (
  // The mockup's SVG, exactly: two concentric rings and five signal bars. Technical, not a toy glyph.
  <svg viewBox="0 0 24 24" aria-hidden>
    <circle className="rng" cx="12" cy="12" r="10" />
    <circle className="rng" cx="12" cy="12" r="6.5" />
    <path className="bar" d="M7 10v4M10 7.5v9M13 6v12M16 9v6M19 11v2" />
  </svg>
)

export function MilesPanel({ agentId, agentName, sent, waiting, needs }: Props) {
  const face = useRef<RudiHandle | null>(null)
  const { mode, setMode, callActive, listening, speaking, pending, startCall, endCall, messages, audioRef } = useTestAi(agentId)

  // The meter reads whoever is actually making sound: the microphone while he is listening, the
  // reply's own audio while he is speaking. Without this the canvas runs its synthetic envelope, and
  // the waveform belongs to neither person in the room.
  const level = useRef<((v: number) => void) | null>(null)
  useEffect(() => { level.current = (v) => face.current?.level(v) }, [])
  useVoiceLevels({ send: level, audio: audioRef, callActive, listening, speaking })

  // AT REST HE IS A PHOTOGRAPH. `minimised` is the canvas's own still-frame mode — no network, no
  // sweep, no video — and on a phone that is what he should be until the mic is pressed. The hook
  // returns null before it has measured, and `!null` is `true`, so the tri-state is read explicitly
  // rather than negated: unknown is treated as not-mobile, which keeps the desktop behaviour.
  const isMobile = useIsMobile()
  const stillAtRest = isMobile === true && !callActive

  // The projection. Three booleans in, four canvas states out — and nothing decided here.
  const lastSpoken = useRef('')
  useEffect(() => {
    const f = face.current
    if (!f) return
    if (speaking) {
      const reply = [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? ''
      if (reply !== lastSpoken.current) {
        lastSpoken.current = reply
        // ~14 characters a second is the rate Aura reads at; the canvas only needs a duration to hold
        // the mouth open for, and stopSpeaking() below is what actually ends it.
        f.speak(reply, Math.max(1200, reply.length * 70))
      }
    } else if (listening) {
      f.listen()
    } else if (callActive) {
      f.arm()
    } else {
      f.endSession()
    }
  }, [speaking, listening, callActive, messages])

  function toggle() {
    if (callActive) { endCall(); return }
    if (mode !== 'voice') setMode('voice')
    startCall()
  }

  // SILENT WHEN THERE IS NOTHING. No drafts, nothing needing a person, nothing sent — then no line and
  // no count. A panel that says "0 drafts waiting" every morning teaches its owner to stop reading it.
  const somethingHappened = sent > 0 || waiting > 0 || needs > 0

  return (
    <div className="v2-mpanel" data-live={callActive || undefined}>
      <RudiCanvas
        // Keyed by persona: the canvas resolves its assets once, at mount.
        key="miles"
        persona="miles"
        handleRef={face}
        className="v2-mface"
        minimised={stillAtRest}
        onClick={toggle}
      />
      <div className="v2-mveil" aria-hidden />

      <div className="v2-mtop">
        <span className="v2-mname">{agentName.toUpperCase()} · MESSAGES</span>
        {/* What is actually happening, in the order it happens. `pending` is the gap between asking
            for audio and hearing it, and calling that "speaking" is what made the mouth move first. */}
        <span className="v2-mduty"><i />
          {speaking ? 'SPEAKING' : pending ? 'THINKING' : listening ? 'LISTENING' : callActive ? 'YOUR TURN' : 'ON DUTY'}
        </span>
      </div>

      {somethingHappened && (
        <div className="v2-mfoot">
          <p className="v2-msum">
            {sent > 0 && <>Sent <b>{sent}</b>. </>}
            {waiting > 0 && <><b>{waiting}</b> {waiting === 1 ? 'draft is' : 'drafts are'} waiting on you. </>}
            {needs > 0 && <><b>{needs}</b> {needs === 1 ? 'needs' : 'need'} you outright.</>}
          </p>
        </div>
      )}

      <button
        type="button"
        className="v2-mmic"
        data-on={callActive || undefined}
        data-hearing={listening || undefined}
        data-talking={speaking || undefined}
        onClick={toggle}
        aria-label={callActive ? `End the conversation with ${agentName}` : `Talk to ${agentName}`}
      >
        <Mic />
      </button>
    </div>
  )
}
