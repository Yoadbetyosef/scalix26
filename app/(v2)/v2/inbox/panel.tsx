'use client'

import { useCallback, useRef, useState } from 'react'
import { RudiCanvas, type RudiHandle, type RudiState } from '../rudi-canvas'
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

const Mic = () => (
  // The mockup's SVG, exactly: two concentric rings and five signal bars. Technical, not a toy glyph.
  <svg viewBox="0 0 24 24" aria-hidden>
    <circle className="rng" cx="12" cy="12" r="10" />
    <circle className="rng" cx="12" cy="12" r="6.5" />
    <path className="bar" d="M7 10v4M10 7.5v9M13 6v12M16 9v6M19 11v2" />
  </svg>
)

const Chat = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 11a7.5 7.5 0 0 1-10.8 6.7L4 19l1.3-4.6A7.5 7.5 0 1 1 20 11z" />
  </svg>
)

export function MilesPanel({ agentName, facts, sent, waiting, needs, only, onOnly }: Props) {
  const face = useRef<RudiHandle | null>(null)
  const [state, setState] = useState<RudiState>('idle')
  const [reply, setReply] = useState<string | null>(null)
  // Hover is held in state rather than in CSS `:has()`, which is not available everywhere this ships,
  // and the styling is gated behind (hover: hover) so a tap can never leave the portrait dimmed.
  const [hovering, setHovering] = useState(false)
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

  // AT REST HE IS ALIVE. The still-frame mode is gone from this panel: it removed the mesh, and the
  // mesh with the sweep crossing it — nodes lighting cyan above the line and violet below — IS the
  // thing that makes a portrait look like an employee rather than a screenshot of one. The full
  // engine runs here, exactly as it does on a desktop.
  //
  // What that costs, and what stops it: the loop halts when the tab is hidden (visibilitychange) and
  // when the portrait leaves the viewport (IntersectionObserver at 0.01). On a phone the hero scrolls
  // with the list, so scrolling past him stops it — the expensive case is looking straight at him,
  // which is the case worth paying for.
  const isMobile = useIsMobile()

  // SILENT WHEN THERE IS NOTHING. No drafts, nothing needing a person, nothing sent — then no line and
  // no count. A panel that says "0 drafts waiting" every morning teaches its owner to stop reading it.
  const somethingHappened = sent > 0 || waiting > 0 || needs > 0

  return (
    <div className="v2-mpanel" data-live={live || undefined}>
      {/* The panel is the gutter; the rail is the card that sits in it. On a phone the card has no
          border, no radius and no shadow and simply fills the top of the screen — same DOM. */}
      <div className="v2-mrail">
        <div className="v2-mportrait" data-hover={hovering || undefined}>
          <RudiCanvas
            key="miles"
            persona="miles"
            handleRef={face}
            onStateChange={setState}
            className="v2-mface"
            // TOUCH SCANS, IT DOES NOT ANSWER. On a phone the mic is the only way into a
            // conversation: a portrait that fills the screen is far too easy to open by accident,
            // and an accidental call is a real one. Read at CLICK time, not at render — useIsMobile
            // returns null until it has measured, and a first render must not decide this.
            onClick={() => (isMobile === true ? face.current?.scan() : toggle())}
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

          {/* THE COLLAPSED LINE. In the DOM always, revealed by CSS when the scroller says the hero
              is a bar — so nothing re-renders as a thumb moves. Counts only, vertically centred. */}
          <p className="v2-mminlab">
            {waiting > 0 && <><b>{waiting}</b> waiting</>}
            {waiting > 0 && needs > 0 && <> · </>}
            {needs > 0 && <><b>{needs}</b> need you</>}
            {waiting === 0 && needs === 0 && <>All clear</>}
          </p>

          {/* The portrait dims behind the ring. Rendered always, opaque only on hover, so nothing
              moves when the pointer arrives. */}
          <div className="v2-mdim" aria-hidden />

          {/* ONE CONTROL, TWO FACES.
              At rest: the technical mic — concentric rings, signal bars, rounded square, dark glass.
              On hover: it becomes the ring Rudi's portrait uses, at the same 84px, the same
              rgba(255,255,255,.1) fill and .75 outline, with the same mono label inside it.
              Same button, same onClick — the hover is a skin, not a second path. */}
          <button
            type="button"
            className="v2-mmic"
            data-on={live || undefined}
            data-hearing={state === 'listening' || undefined}
            data-talking={state === 'speaking' || undefined}
            data-touch
            onClick={toggle}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            aria-label={live ? `End the conversation with ${agentName}` : `Talk to ${agentName}`}
          >
            <Mic />
            {/* The label the ring carries. Same vocabulary as the cursor over her portrait. */}
            <em className="v2-mmlab">{live ? 'END' : 'TALK'}</em>
          </button>
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
