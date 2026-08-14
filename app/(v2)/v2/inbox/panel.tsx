'use client'

import { useCallback, useRef, useState } from 'react'
import { RudiCanvas, type RudiHandle, type RudiState } from '../rudi-canvas'
import { TalkButton } from '../talk-button'
import { useIsMobile } from '../use-breakpoint'
import { AmyRealtime, type AmyMoment } from '@/components/dashboard/hero/amy-realtime'
import { useAmySession } from '@/components/dashboard/hero/use-amy-session'
import { milesBriefing, buildMilesPrompt, type MilesFacts } from '@/lib/miles/briefing'

// MILES, AT THE TOP OF HIS OWN SCREEN.
//
// A hero panel, not a floating button: he is an employee, not a help widget. Portrait, ON DUTY, one
// line about what happened, and the same press-to-talk control the phone employee has.
//
// ── ONE VOICE LOOP IN THE CODEBASE ──────────────────────────────────────────────────────────────────
//
// This used to run its own: SpeechRecognition, /api/ai/test, /api/ai/speak, an <audio> element and a
// hand-rolled turn machine. It failed in a new way every time it was touched — the mouth moved before
// any sound existed, a stale closure meant recognition never started, two recognisers answered one
// sentence — and none of those were failures of the design; they were failures of writing turn-taking
// twice.
//
// It now runs the SAME session the home screen runs: one socket to the Deepgram Voice Agent, which
// owns endpointing, barge-in and turn-taking, and which streams audio both ways. Everything hard
// comes with it, including the noise gate that exists because an employee's own TTS gets transcribed
// as user speech — that gate is not reimplemented here, and must not be.
//
// What the persona changes: the portrait, the ground, the voice id — and the brief, because an
// employee who knows the business but not his own job is not a persona, it is a costume.

export type GroupKey = 'waiting' | 'needs' | 'handled'

interface Props {
  agentName: string
  /** Everything he is told about his own job. See lib/miles/briefing.ts. */
  facts: MilesFacts
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

export function MilesPanel({ agentName, facts, sent, waiting, needs, only, onOnly }: Props) {
  const face = useRef<RudiHandle | null>(null)
  const [state, setState] = useState<RudiState>('idle')
  const [reply, setReply] = useState<string | null>(null)
  const session = useAmySession()

  // The portrait, driven by the session's own moments — the same projection the home screen uses.
  // Every branch calls a method the canvas already exposes; nothing here decides anything about the
  // conversation, including when a turn begins or ends.
  const onMoment = useCallback((m: AmyMoment) => {
    const f = face.current
    if (!f) return
    if (m.type === 'listen') f.listen()
    else if (m.type === 'level') f.level(m.value)
    else if (m.type === 'speak') { setReply(m.text || null); f.speak(m.text, m.ms) }
    else if (m.type === 'stopSpeaking') f.stopSpeaking()
    else if (m.type === 'arm') f.arm()
    else if (m.type === 'reply') setReply(m.text)
  }, [])

  const live = session.mode === 'live'

  const toggle = useCallback(() => {
    // Live already → this is the END the control promises, not a second session.
    if (session.mode !== 'idle') {
      session.close()
      face.current?.endSession()
      setReply(null)
      return
    }
    // goLive unlocks the AudioContext INSIDE the tap, which is what the autoplay policy requires.
    session.goLive()
  }, [session])

  // AT REST HE IS A PHOTOGRAPH. `minimised` is the canvas's own still-frame mode — no network, no
  // sweep, no video — and on a phone that is what he should be until the control is pressed. The hook
  // returns null before it has measured, and `!null` is `true`, so the tri-state is read explicitly:
  // unknown is treated as not-mobile, which keeps the desktop behaviour.
  const isMobile = useIsMobile()
  const stillAtRest = isMobile === true && !live

  // SILENT WHEN THERE IS NOTHING. No drafts, nothing needing a person, nothing sent — then no line and
  // no count. A panel that says "0 drafts waiting" every morning teaches its owner to stop reading it.
  const somethingHappened = sent > 0 || waiting > 0 || needs > 0

  return (
    <div className="v2-mpanel" data-live={live || undefined}>
      {/* The panel is the gutter; the rail is the card that sits in it. On a phone the card has no
          border, no radius and no shadow and simply fills the top of the screen — same DOM. */}
      <div className="v2-mrail">
        <div className="v2-mportrait">
          <RudiCanvas
            key="miles"
            persona="miles"
            handleRef={face}
            onStateChange={setState}
            className="v2-mface"
            minimised={stillAtRest}
            onClick={toggle}
          />
          <div className="v2-mveil" aria-hidden />

          <div className="v2-mtop">
            <span className="v2-mname">{agentName.toUpperCase()} · MESSAGES</span>
            <span className="v2-mduty"><i />{live ? 'LIVE' : 'ON DUTY'}</span>
          </div>

          {(reply || somethingHappened) && (
            <div className="v2-mfoot">
              <p className="v2-msum">
                {reply ?? (
                  <>
                    {sent > 0 && <>Sent <b>{sent}</b>. </>}
                    {waiting > 0 && <><b>{waiting}</b> {waiting === 1 ? 'draft is' : 'drafts are'} waiting on you. </>}
                    {needs > 0 && <><b>{needs}</b> {needs === 1 ? 'needs' : 'need'} you outright.</>}
                  </>
                )}
              </p>
            </div>
          )}

          {/* THE SAME CONTROL THE PHONE EMPLOYEE HAS, in the same place relative to the portrait. */}
          <div className="v2-mtalk">
            <TalkButton state={state} onTalk={toggle} hint={false} variant="onPortrait" />
          </div>
        </div>

        {/* ── THE REST OF THE RAIL. Desktop only: on a phone the panel is the portrait and its line,
               and these three blocks are the groups already below it. ───────────────────────────── */}

        <p className="v2-msay">
          {reply ?? (somethingHappened
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

        <button type="button" className="v2-mask" onClick={toggle}>
          <Chat />Ask {agentName} something
        </button>
      </div>

      {/* The session itself. Renders nothing on this surface — the portrait IS its interface. */}
      {live && (
        <AmyRealtime
          briefing={milesBriefing(facts)}
          audioCtx={session.audioCtx}
          onClose={() => { session.close(); face.current?.endSession(); setReply(null) }}
          onType={session.goText}
          onMoment={onMoment}
          surface="v2"
          prompt={buildMilesPrompt(facts)}
          // His brief already carries the inbox. The dashboard's snapshot is another employee's job.
          snapshotUrl={null}
        />
      )}
    </div>
  )
}
