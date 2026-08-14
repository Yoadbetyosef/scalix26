'use client'

import { useEffect, useRef, useState } from 'react'
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

export type GroupKey = 'waiting' | 'needs' | 'handled'

interface Props {
  /** Miles's own agent row. The sandbox machine answers as whoever this is. */
  agentId: string
  agentName: string
  /** What actually happened. Every one of these is a count of real rows. */
  sent: number
  waiting: number
  needs: number
  /** Which group the list is showing, and how to change it. The rail's counts are the filter. */
  only: GroupKey | null
  onOnly: (k: GroupKey | null) => void
}

const Chat = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 11a7.5 7.5 0 0 1-10.8 6.7L4 19l1.3-4.6A7.5 7.5 0 1 1 20 11z" />
  </svg>
)

const Mic = () => (
  // The mockup's SVG, exactly: two concentric rings and five signal bars. Technical, not a toy glyph.
  <svg viewBox="0 0 24 24" aria-hidden>
    <circle className="rng" cx="12" cy="12" r="10" />
    <circle className="rng" cx="12" cy="12" r="6.5" />
    <path className="bar" d="M7 10v4M10 7.5v9M13 6v12M16 9v6M19 11v2" />
  </svg>
)

export function MilesPanel({ agentId, agentName, sent, waiting, needs, only, onOnly }: Props) {
  const face = useRef<RudiHandle | null>(null)
  const {
    mode, setMode, callActive, listening, speaking, pending, startCall, endCall, messages, audioRef,
    input, setInput, handleChatSubmit,
  } = useTestAi(agentId)
  const [asking, setAsking] = useState(false)

  // The last thing he actually said, spoken or typed. It replaces his standing line in the say box —
  // asking a question and getting the same sentence back would read as nothing having happened.
  const answer = [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? null

  // The meter reads whoever is actually making sound: the microphone while he is listening, the
  // reply's own audio while he is speaking. Without this the canvas runs its synthetic envelope, and
  // the waveform belongs to neither person in the room.
  const level = useRef<((v: number) => void) | null>(null)
  useEffect(() => { level.current = (v) => face.current?.level(v) }, [])
  const { prime } = useVoiceLevels({ send: level, audio: audioRef, callActive, listening, speaking })

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
    // Inside the gesture, before anything awaits: this is what keeps the audio context running.
    prime()
    if (mode !== 'voice') setMode('voice')
    startCall()
  }

  // SILENT WHEN THERE IS NOTHING. No drafts, nothing needing a person, nothing sent — then no line and
  // no count. A panel that says "0 drafts waiting" every morning teaches its owner to stop reading it.
  const somethingHappened = sent > 0 || waiting > 0 || needs > 0

  return (
    <div className="v2-mpanel" data-live={callActive || undefined}>
      {/* The panel is the gutter; the rail is the card that sits in it. On a phone the card has no
          border, no radius and no shadow and simply fills the top of the screen — same DOM. */}
      <div className="v2-mrail">
      <div className="v2-mportrait">
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

      {/* ── THE REST OF THE RAIL. Desktop only: on a phone the panel is the portrait and its line,
             and these three blocks are the groups already below it. ─────────────────────────────── */}

      {/* His line, in a paper box rather than over the photograph. Same sentence, different placement
          — the reference puts it under the portrait once there is a column to put it in. */}
      <p className="v2-msay">
        {answer ?? (somethingHappened
          ? [
              sent > 0 ? `Sent ${sent}.` : null,
              waiting > 0 ? `${waiting} ${waiting === 1 ? 'draft is' : 'drafts are'} waiting on you.` : null,
              needs > 0 ? `${needs} ${needs === 1 ? 'needs' : 'need'} you outright.` : null,
            ].filter(Boolean).join(' ')
          : `I've got your inbox. I'll pull you in when I actually need you.`)}
      </p>

      {/* The three counts, as filters. Clicking one shows that group alone. */}
      <div className="v2-mstats">
        {([
          ['waiting', 'Waiting on you', waiting, 'var(--v2-hold)'],
          ['needs', 'Needs you', needs, 'var(--v2-pink)'],
          ['handled', 'Handled', sent, 'var(--v2-miles)'],
        ] as const).map(([key, label, count, dot]) => (
          <button
            key={key}
            type="button"
            className="v2-mstat"
            data-on={only === key || undefined}
            onClick={() => onOnly(only === key ? null : key)}
          >
            <span className="k" style={{ background: dot }} />
            <span className="l">{label}</span>
            <span className="v">{count}</span>
          </button>
        ))}
      </div>

      {/* The spacer is what keeps the button at the bottom of the card at every window height, and
          the stats scroll rather than the button being clipped. */}
      <div className="v2-mspacer" />

      {asking ? (
        <form
          className="v2-mask"
          onSubmit={(e) => { e.preventDefault(); if (input.trim()) handleChatSubmit(e) }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask ${agentName} something`}
            aria-label={`Ask ${agentName} something`}
            autoFocus
          />
        </form>
      ) : (
        <button type="button" className="v2-mask" onClick={() => { setMode('chat'); setAsking(true) }}>
          <Chat />Ask {agentName} something
        </button>
      )}
      </div>
    </div>
  )
}
