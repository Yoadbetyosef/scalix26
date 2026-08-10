'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { RudiCanvas, type RudiHandle, type RudiState } from './rudi-canvas'
import { Composer } from './composer'
import { Rail } from './rail'
import { rudiCursor, rudiReply, type ReplyFacts, type RudiSegment } from './rudi-line'
import { useIsMobile } from './use-breakpoint'
import { Cursor, Palette, useMagnet, usePalette } from './interactions'
import { startVoice, type VoiceSession } from './browser-voice'
import type { HomeData, ShellData } from './data'
import { mark, startTiming } from './timing'
import {
  AiBadge, Caption, CardSkeleton, ColumnSkeleton, JobCount, RailCount, RightColumn, SheetBody, TodayList,
} from './deferred'

// The interactive shell.
//
// It renders from `shell` alone — a business name and a phone number — so the hero, the composer and
// the rail exist before the numbers do. Everything that needs a figure sits inside a <Suspense> and
// reads the streamed promise through use(); nothing here awaits it.

/** After this long with no interaction the hero collapses and the animation stops. */
const IDLE_MS = 60_000

/** How long the armed state waits before the session closes. The hairline drains over exactly this. */
const ARMED_TIMEOUT_MS = 12_000

const GROUPS = [
  { id: 'g1', label: 'Rudi', items: [{ label: 'AI Employees' }, { label: 'Knowledge' }, { label: 'Test AI' }] },
  { id: 'g2', label: 'Business', items: [{ label: 'Orders' }, { label: 'Analytics' }, { label: 'Reports' }] },
  { id: 'g3', label: 'Account', items: [{ label: 'Billing' }, { label: 'Settings' }, { label: 'Sign Out', out: true }] },
]

export function HomeClient({ shell, dataPromise }: { shell: ShellData; dataPromise: Promise<HomeData> }) {
  const rudi = useRef<RudiHandle | null>(null)
  const [state, setState] = useState<RudiState>('idle')
  const [minimised, setMinimised] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMobile = useIsMobile()

  // Two lines, never three: `said` is what the owner typed, echoed once; the reply REPLACES the
  // caption rather than appending to it. No transcript array — this screen is a presence, not a log.
  const [said, setSaid] = useState<string | null>(null)
  const [reply, setReply] = useState<RudiSegment[] | null>(null)
  const [jump, setJump] = useState<number | null>(null)
  const [typing, setTyping] = useState(false)
  const [talkEl, setTalkEl] = useState<HTMLButtonElement | null>(null)
  const palette = usePalette()
  useMagnet(talkEl, typing)

  // The facts, read off the same promise WITHOUT suspending — a conversation can start before the
  // figures land, and the reply says so rather than inventing one.
  // FIRST effect in the shell, so it fires as soon as React has hydrated this component — which is
  // the moment its click handlers become real. Anything before this and the button is inert markup.
  useEffect(() => { mark('shell'); startTiming() }, [])

  const facts = useRef<ReplyFacts | null>(null)
  useEffect(() => {
    let alive = true
    // AWAIT, not .then().catch().
    //
    // A promise handed from a server component to a client component is NOT a Promise — React
    // serialises it as a ReactPromise, whose prototype is Object.create(Promise.prototype) so it
    // looks like one, but whose `then` registers callbacks and RETURNS NOTHING. Chaining `.catch`
    // off it therefore reads a property of undefined and throws, which is what took the whole screen
    // to the error boundary.
    //
    // `await` is specified to work on any thenable and ignores what `then` returns, so it is correct
    // here where chaining is not. use() elsewhere in this file works for the same reason.
    void (async () => {
      try {
        const d = await dataPromise
        // When the streamed numbers actually landed. Compared against the hydration mark, this
        // answers whether the data is holding up interactivity or merely arriving after it.
        mark('data')
        if (alive) facts.current = d.facts
      } catch {
        // Swallowed deliberately: this read is an optimisation for the reply text. The Suspense
        // boundaries consume the same promise and are what surface a real failure to the owner.
      }
    })()
    return () => { alive = false }
  }, [dataPromise])

  /** The typed path's answer. Voice goes through browser-voice.ts, which calls rudiReply itself. */
  const replyTo = useCallback((heard: string) => (
    facts.current
      ? rudiReply(heard, facts.current)
      : 'One moment — I am still pulling today’s numbers.'
  ), [])

  // The idle collapse, suspended while she is listening, speaking or armed: collapsing
  // mid-conversation would be the screen interrupting itself.
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

  // The voice harness. The component knows nothing about it — see browser-voice.ts, which is the one
  // file the Deepgram agent replaces.
  const voice = useRef<VoiceSession | null>(null)
  const endSession = useCallback(() => {
    voice.current?.stop(); voice.current = null
    rudi.current?.endSession()
  }, [])
  useEffect(() => () => { endSession() }, [endSession])

  const toggleTalk = useCallback(() => {
    wake()
    const r = rudi.current
    if (!r) return
    if (r.state() === 'idle') {
      setSaid(null)
      setReply(null)
      voice.current?.stop()
      voice.current = startVoice(r, {
        facts: () => facts.current,
        onHeard: setSaid,
        onReply: (text) => setReply([{ text }]),
        onEnd: () => { voice.current = null },
        armedMs: ARMED_TIMEOUT_MS,
      })
    } else {
      endSession()
    }
  }, [wake, endSession])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (typing || palette.open) return
      if (e.code === 'Space') { e.preventDefault(); toggleTalk() }
      if (e.key === 'Escape') { e.preventDefault(); endSession(); wake() }
      if (/^[1-4]$/.test(e.key)) { e.preventDefault(); setJump(Number(e.key) - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleTalk, typing, palette.open, wake, endSession])

  const onSubmit = useCallback((text: string) => {
    setSaid(text)
    const answer = replyTo(text)
    setReply([{ text: answer }])
    rudi.current?.speak(answer, 4200)
    setTimeout(() => rudi.current?.arm(), 4200)
  }, [replyTo])

  // Listening clears the caption; armed KEEPS her last sentence, because it is the thing being
  // answered. Only the resting line needs the numbers, so only that case can suspend.
  const override: RudiSegment[] | null =
    state === 'listening' ? []
      : reply ?? (state === 'speaking' ? [{ text: 'Rudi is speaking.', accent: true }] : null)

  const hero = (
    <>
      <RudiCanvas
        handleRef={rudi}
        onStateChange={setState}
        minimised={minimised}
        className="v2-face"
        onClick={() => (minimised ? wake() : toggleTalk())}
      />
      <div className="v2-scrim" />
    </>
  )

  const hairline = state === 'armed' && (
    <div className="v2-hair" aria-hidden><i style={{ animationDuration: `${ARMED_TIMEOUT_MS}ms` }} /></div>
  )

  // A one-line skeleton rather than an empty block, so the composer does not jump when the line lands.
  const caption = (
    <Suspense fallback={
      <p className="v2-cap" aria-hidden><span className="v2-skel-bar" style={{ width: '68%', height: 22 }} /></p>
    }>
      <Caption p={dataPromise} override={override} />
    </Suspense>
  )

  const count = (pick: (d: HomeData) => number | null) => (
    <Suspense fallback={null}><RailCount p={dataPromise} pick={pick} /></Suspense>
  )

  if (isMobile === null) return <div className="v2-app" aria-hidden />

  if (!isMobile) {
    return (
      <div className="v2-app">
        <Cursor label={rudiCursor(state, minimised)} active={!typing} />
        <Palette
          commands={[
            ...['Leads', 'Inbox', 'Appointments', 'Contacts'].map((label, n) => ({ label, hint: String(n + 1) })),
            ...GROUPS.flatMap((g) => g.items.map((x) => ({ label: x.label, hint: g.label }))),
          ]}
          open={palette.open}
          onClose={palette.close}
        />

        <Rail
          businessName={shell.businessName}
          primary={[
            { label: 'Leads', count: count((d) => d.railCounts.leads) },
            { label: 'Inbox', count: count((d) => d.railCounts.inbox) },
            { label: 'Appointments', count: count((d) => d.railCounts.appointments) },
            { label: 'Contacts' },
          ]}
          groups={GROUPS.map((g) => (g.id !== 'g1' ? g : {
            ...g,
            items: g.items.map((it) => (it.label !== 'AI Employees' ? it : {
              ...it,
              count: <Suspense fallback={null}><AiBadge p={dataPromise} /></Suspense>,
            })),
          }))}
          activeIndex={jump}
        />

        <main className="v2-stage" data-min={minimised || undefined}>
          <div className="v2-home">
            {hero}
            <div className="v2-overlay">
              {shell.phone && <p className="v2-tag">Rudi · listening on {shell.phone}</p>}
              {said && <p className="v2-you">You · {said}</p>}
              {caption}
              {hairline}
              <Composer
                state={state}
                onTalk={toggleTalk}
                onSubmit={onSubmit}
                onTypingChange={setTyping}
                buttonRef={setTalkEl}
              />
            </div>
          </div>

          <div className="v2-dash" data-scroll>
            <Suspense fallback={<><h3>Today</h3><CardSkeleton /></>}>
              <TodayList p={dataPromise} />
            </Suspense>
          </div>
        </main>

        <aside className="v2-side" data-scroll>
          <Suspense fallback={<ColumnSkeleton />}>
            <RightColumn p={dataPromise} />
          </Suspense>
        </aside>
      </div>
    )
  }

  return (
    <div className="v2-mobile">
      <div className="v2-frame">{hero}</div>
      <div className="v2-top">
        <b>{shell.businessName}</b>
        <i><s /><Suspense fallback={<>&mdash;</>}><JobCount p={dataPromise} /></Suspense></i>
      </div>
      <div className="v2-ov">
        {shell.phone && <p className="v2-tag">Rudi · listening on {shell.phone}</p>}
        {said && <p className="v2-you">You · {said}</p>}
        {caption}
      </div>
      <Suspense fallback={null}>
        <SheetBody p={dataPromise} />
      </Suspense>
      <div className="v2-sticky">
        {hairline}
        <Composer state={state} onTalk={toggleTalk} full onSubmit={onSubmit} onTypingChange={setTyping} />
      </div>
    </div>
  )
}
