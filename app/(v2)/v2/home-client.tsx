'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RudiCanvas, type RudiHandle, type RudiState } from './rudi-canvas'
import { Composer } from './composer'
import { Rail } from './rail'
import { Sheet, type NeedsItem, type NowItem, type Tile } from './sheet'
import { rudiReply, type ReplyFacts, type RudiSegment } from './rudi-line'
import {
  VAD_THRESHOLD, VAD_THRESHOLD_DUPLEX, createVad, hasSpeechRecognition, listenForText, openMic, say,
  type MicHandle, type TranscriptHandle, type Vad,
} from './voice'
import { useIsMobile } from './use-breakpoint'
import { Cursor, Palette, useMagnet, usePalette } from './interactions'

// The interactive shell. Everything below the data boundary — the page hands it real numbers and
// this owns state, the idle timer, and the Rudi handle.

export interface HomeData {
  businessName: string
  phone: string | null
  line: RudiSegment[]
  rail: {
    primary: { label: string; count?: number | null; badge?: string }[]
    groups: { id: string; label: string; items: { label: string; count?: number | null; badge?: string; out?: boolean }[] }[]
  }
  rightNow: NowItem[]
  needsYou: NeedsItem[]
  monthLabel: string
  monthStats: { label: string; value: string }[]
  tiles: Tile[]
  /** Recent activity, newest first. Shown behind the collapsed hero. */
  recent: { time: string; text: string }[]
  /** Everything the local reply function answers from. Real numbers, already on the page. */
  facts: ReplyFacts
}

/** After this long with no interaction the hero collapses and the animation stops. */
const IDLE_MS = 60_000

/**
 * How long the session waits, armed, before closing itself.
 *
 * Long enough to think about what to ask next; short enough that a room left alone does not sit with
 * an open microphone. The hairline drains over exactly this, so it is visible rather than a surprise
 * — speaking at any point restarts it.
 */
const ARMED_TIMEOUT_MS = 12_000

export function HomeClient({ data }: { data: HomeData }) {
  const rudi = useRef<RudiHandle | null>(null)
  const [state, setState] = useState<RudiState>('idle')
  const [minimised, setMinimised] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMobile = useIsMobile()
  // Two lines, never three. `said` is what the owner typed, echoed once above the caption; the reply
  // REPLACES the caption rather than appending to it. There is deliberately no transcript array —
  // this screen is a presence, not a chat log.
  const [said, setSaid] = useState<string | null>(null)
  const [reply, setReply] = useState<RudiSegment[] | null>(null)
  const [jump, setJump] = useState<number | null>(null)
  const [typing, setTyping] = useState(false)
  const [talkEl, setTalkEl] = useState<HTMLButtonElement | null>(null)
  const mic = useRef<MicHandle | null>(null)
  const transcript = useRef<TranscriptHandle | null>(null)
  const stopSay = useRef<(() => void) | null>(null)
  // Only true when audio is actually flowing. The canvas prints LISTENING · DEMO otherwise, so the
  // meter never implies it is hearing something it is not.
  const [micLive, setMicLive] = useState(false)
  const palette = usePalette()
  useMagnet(talkEl, typing)

  // The idle collapse. Restarts on any deliberate interaction, and is suspended entirely while Rudi
  // is listening or speaking — collapsing mid-sentence would be the screen interrupting itself.
  const kick = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      if (rudi.current?.state() === 'idle') setMinimised(true)
    }, IDLE_MS)
  }, [])

  useEffect(() => {
    if (state === 'idle') kick()
    else if (idleTimer.current) clearTimeout(idleTimer.current)
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current) }
  }, [state, kick])

  const wake = useCallback(() => { setMinimised(false); kick() }, [kick])

  // ── THE SESSION ────────────────────────────────────────────────────────────────────────────────
  //
  //   idle -> listening -> speaking -> armed -> listening -> …
  //
  // with barge-in short-circuiting speaking -> listening at any moment.
  //
  // ONE press opens it and one press closes it. Inside, turns pass on their own: the microphone stays
  // OPEN for the whole session — not reopened per turn — which is what makes both barge-in and the
  // armed meter possible. Reopening the mic per turn would mean a permission-shaped gap between every
  // sentence, and a device that cannot hear an interruption because it is not listening for one.

  const sessionRef = useRef(false)
  const vadRef = useRef<Vad | null>(null)
  const armedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [armedKey, setArmedKey] = useState(0)
  const heardRef = useRef('')

  /** Close everything and return to idle. */
  const endSession = useCallback(() => {
    sessionRef.current = false
    if (armedTimer.current) { clearTimeout(armedTimer.current); armedTimer.current = null }
    transcript.current?.stop(); transcript.current = null
    stopSay.current?.(); stopSay.current = null
    mic.current?.stop(); mic.current = null
    vadRef.current?.reset(); vadRef.current = null
    setMicLive(false)
    rudi.current?.endSession()
  }, [])

  /** Start a listening turn. The mic is already open; this only opens the transcript. */
  const openTurn = useCallback(() => {
    if (!sessionRef.current) return
    if (armedTimer.current) { clearTimeout(armedTimer.current); armedTimer.current = null }
    heardRef.current = ''
    setSaid(null)
    rudi.current?.listen()
    transcript.current?.stop()
    transcript.current = hasSpeechRecognition()
      ? listenForText(
        (text) => { heardRef.current = text; setSaid(text || null) },
        // The engine's own endpointing is a second opinion, not the authority — VAD decides the turn.
        // Whichever fires first wins, and both funnel through the same reply.
        () => { transcript.current = null },
      )
      : null
  }, [])

  /** She has finished. The mic stays open and it is my turn. */
  const arm = useCallback(() => {
    if (!sessionRef.current) return
    transcript.current?.stop(); transcript.current = null
    vadRef.current?.reset()
    rudi.current?.arm()
    setArmedKey((k) => k + 1)   // restarts the draining hairline
    if (armedTimer.current) clearTimeout(armedTimer.current)
    armedTimer.current = setTimeout(() => {
      if (rudi.current?.state() === 'armed') endSession()
    }, ARMED_TIMEOUT_MS)
  }, [endSession])

  /** Answer out loud, then arm. */
  const answer = useCallback((heard: string) => {
    if (!sessionRef.current) return
    transcript.current?.stop(); transcript.current = null
    const text = rudiReply(heard, data.facts)
    setReply([{ text }])
    stopSay.current?.()
    // Driven by the utterance's OWN onstart/onend, so the video runs exactly as long as the voice.
    // onend hands the floor back automatically — that is the turn passing without a press.
    stopSay.current = say(
      text,
      () => rudi.current?.speak(text, 120_000),
      () => {
        rudi.current?.stopSpeaking()
        stopSay.current = null
        arm()
      },
    )
  }, [data.facts, arm])

  /** Cut her off mid-sentence and hand me the floor. The one thing that makes this feel alive. */
  const bargeIn = useCallback(() => {
    stopSay.current?.(); stopSay.current = null
    rudi.current?.stopSpeaking()
    openTurn()
  }, [openTurn])

  const beginSession = useCallback(async () => {
    sessionRef.current = true
    setSaid(null)
    setReply(null)
    rudi.current?.listen()

    // ── The duplex guard ────────────────────────────────────────────────────────────────────────
    // The threshold is raised while she speaks. Echo cancellation removes most of her playback and
    // the raised floor covers the rest, so her own voice cannot open a turn — while a real
    // interruption, which is louder and closer, still can.
    const vad = createVad({
      threshold: () => (rudi.current?.state() === 'speaking' ? VAD_THRESHOLD_DUPLEX : VAD_THRESHOLD),
      onStart: () => {
        const st = rudi.current?.state()
        if (st === 'speaking') bargeIn()
        else if (st === 'armed') openTurn()
      },
      onEnd: () => {
        // Silence ended a listening turn. This is the moment a walkie-talkie would need a button.
        if (rudi.current?.state() === 'listening') answer(heardRef.current)
      },
    })
    vadRef.current = vad

    const handle = await openMic((v) => {
      rudi.current?.level(v)
      vad.push(v, performance.now())
    })
    if (!sessionRef.current) { handle?.stop(); return }
    mic.current = handle
    setMicLive(!!handle)

    openTurn()

    // No microphone: VAD can never fire, so nothing would ever end the turn. Fall back to the
    // pause-and-answer behaviour rather than leaving the session stuck open.
    if (!handle) {
      armedTimer.current = setTimeout(() => {
        if (rudi.current?.state() === 'listening') answer(heardRef.current)
      }, 3000)
    }
  }, [answer, bargeIn, openTurn])

  const toggleTalk = useCallback(() => {
    wake()
    const r = rudi.current
    if (!r) return
    if (r.state() === 'idle') void beginSession()
    else endSession()
  }, [wake, beginSession, endSession])

  useEffect(() => () => { endSession() }, [endSession])

  // Space toggles, matching the SPACE affordance printed on the button. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (typing || palette.open) return
      if (e.code === 'Space') { e.preventDefault(); toggleTalk() }
      // Esc goes home: stop whatever Rudi is doing and bring a collapsed hero back.
      if (e.key === 'Escape') { e.preventDefault(); endSession(); wake() }
      // 1-4 jump to the primary destinations. /v2 navigates nowhere, so this highlights the row it
      // WOULD open rather than pretending to route.
      if (/^[1-4]$/.test(e.key)) { e.preventDefault(); setJump(Number(e.key) - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleTalk, typing, palette.open, wake, endSession])

  // Listening shows no caption at all — the meter is the message, and the reference clears the line.
  // Armed KEEPS her last sentence. Clearing it would take away the thing I am answering, and leave
  // the screen saying nothing at the exact moment it is my turn to reply to something.
  const caption: RudiSegment[] =
    state === 'listening' ? []
      : reply ?? (state === 'speaking' ? [{ text: 'Rudi is speaking.', accent: true }] : data.line)

  // Typing is read-only here: the line is echoed and Rudi answers with what the real numbers already
  // say. No request is made, and no answer is invented.
  // Typed text takes the same path, including opening a session so her answer arms afterwards.
  const onSubmit = useCallback((text: string) => {
    setSaid(text)
    if (!sessionRef.current) { sessionRef.current = true }
    answer(text)
  }, [answer])

  // ONE canvas, in ONE tree. See use-breakpoint.ts: rendering the hero into both trees and hiding one
  // with CSS gave two canvases racing for the same imperative ref, and the hidden one won.
  const hero = (
    <>
      <RudiCanvas
        handleRef={rudi}
        onStateChange={setState}
        minimised={minimised}
        micLive={micLive}
        className="v2-face"
        onClick={() => (minimised ? wake() : toggleTalk())}
      />
      <div className="v2-scrim" />
    </>
  )

  // Nothing until the breakpoint is measured — one frame of the wrong layout is worse than one frame
  // of none, and the canvas would size itself against a viewport it is about to leave.
  if (isMobile === null) return <div className="v2-app" aria-hidden />

  const cursorLabel = minimised ? 'EXPAND' : state === 'idle' ? 'TALK' : 'STOP'

  if (!isMobile) {
    return (
      <div className="v2-app">
        <Cursor label={cursorLabel} active={!typing} />
        <Palette
          commands={[
            ...data.rail.primary.map((x, n) => ({ label: x.label, hint: String(n + 1) })),
            ...data.rail.groups.flatMap((g) => g.items.map((x) => ({ label: x.label, hint: g.label }))),
          ]}
          open={palette.open}
          onClose={palette.close}
        />
        <Rail
          businessName={data.businessName}
          primary={data.rail.primary}
          groups={data.rail.groups}
          activeIndex={jump}
        />

        <main className="v2-stage" data-min={minimised || undefined}>
          <div className="v2-home">
            {hero}
            <div className="v2-overlay">
              {data.phone && <p className="v2-tag">Rudi · listening on {data.phone}</p>}
              {said && <p className="v2-you">You · {said}</p>}
              <p className="v2-cap">
                {caption.map((s, i) => (s.accent ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
              </p>
              {/* The silence timeout, draining. Keyed on armedKey so it restarts from full on every
                  new armed turn, and it is the reason the session closing is never a surprise:
                  speaking at any point resets it. */}
              {state === 'armed' && (
                <div className="v2-hair" key={armedKey} aria-hidden>
                  <i style={{ animationDuration: `${ARMED_TIMEOUT_MS}ms` }} />
                </div>
              )}
              <Composer
                state={state}
                onTalk={toggleTalk}
                onSubmit={onSubmit}
                onTypingChange={setTyping}
                buttonRef={setTalkEl}
              />
            </div>
          </div>

          {/* Revealed as the hero collapses: Today, then what has already happened. Rendered from the
              same figures the right column uses — the collapse changes the arrangement, not the
              data, so nothing here can disagree with the panel beside it. */}
          <div className="v2-dash" data-scroll>
            <h3>Today</h3>
            {data.rightNow.length === 0
              ? <p className="v2-dempty">Nothing booked for today.</p>
              : data.rightNow.map((n) => (
                <button key={n.title} type="button" className="v2-dline" disabled title="v2 preview">
                  <time>{n.detail.split(' · ')[0] || '—'}</time>
                  <p>{n.title}</p>
                </button>
              ))}

            <h3 data-mt="true">Recent</h3>
            {data.recent.length === 0
              ? <p className="v2-dempty">Nothing yet today.</p>
              : data.recent.map((r, i) => (
                <button key={i} type="button" className="v2-dline" disabled title="v2 preview">
                  <time>{r.time}</time>
                  <p>{r.text}</p>
                </button>
              ))}
          </div>
        </main>

        <aside className="v2-side" data-scroll>
          <p className="v2-kick" data-tone="live"><i />Right now</p>
          {data.rightNow.length === 0
            ? <div className="v2-card" data-empty><p>Nothing on today</p><span>No appointments booked.</span></div>
            : data.rightNow.map((n) => (
              <div key={n.title} className="v2-card">
                <p>{n.title}</p>
                <span>{n.detail}</span>
              </div>
            ))}

          <div className="v2-blk">
            <p className="v2-kick" data-tone="warn"><i />Needs you{data.needsYou.length > 0 ? ` · ${data.needsYou.length}` : ''}</p>
            {data.needsYou.length === 0
              ? <div className="v2-card" data-empty><p>Nothing needs you</p><span>Every lead has been answered.</span></div>
              : data.needsYou.map((n) => (
                <button key={n.title} type="button" className="v2-card v2-item" disabled title="v2 preview">
                  <p>{n.title}</p>
                  <em>{n.detail}</em>
                </button>
              ))}
          </div>

          <div className="v2-blk">
            <p className="v2-kick"><i />This month · {data.monthLabel}</p>
            {data.monthStats.length > 0 && (
              <div className="v2-big">
                <b>{data.monthStats[0].value}</b>
                <span>{data.monthStats[0].label}</span>
              </div>
            )}
            {data.monthStats.length > 1 && (
              <div className="v2-mini">
                {data.monthStats.slice(1).map((s) => (
                  <div key={s.label}>
                    <b>{s.value}</b>
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
      </aside>
      </div>
    )
  }

  return (
    <div className="v2-mobile">
        <div className="v2-frame">{hero}</div>
        <div className="v2-top">
          <b>{data.businessName}</b>
          <i><s />{data.rightNow.length.toString().padStart(2, '0')}</i>
        </div>
        <div className="v2-ov">
          {data.phone && <p className="v2-tag">Rudi · listening on {data.phone}</p>}
          {said && <p className="v2-you">You · {said}</p>}
          <p className="v2-cap">
            {caption.map((s, i) => (s.accent ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
          </p>
        </div>
        <Sheet
          now={data.rightNow}
          needs={data.needsYou}
          tiles={data.tiles}
          monthLabel={data.monthLabel}
          monthStats={data.monthStats}
        />
      <div className="v2-sticky">
        {state === 'armed' && (
          <div className="v2-hair" key={armedKey} aria-hidden>
            <i style={{ animationDuration: `${ARMED_TIMEOUT_MS}ms` }} />
          </div>
        )}
        <Composer state={state} onTalk={toggleTalk} full onSubmit={onSubmit} onTypingChange={setTyping} />
      </div>
    </div>
  )
}
