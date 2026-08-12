'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { RudiCanvas, type RudiHandle, type RudiState } from './rudi-canvas'
import { Composer } from './composer'
import { Rail } from './rail'
import { rudiCursor, type RudiSegment } from './rudi-line'
import { useIsMobile } from './use-breakpoint'
import { Cursor, Palette, useMagnet, usePalette } from './interactions'
import type { AmyMoment } from '@/components/dashboard/hero/amy-realtime'
import { useAmySession } from '@/components/dashboard/hero/use-amy-session'
import type { HomeData, ShellData } from './data'
import { mark, startTiming } from './timing'
import {
  AiBadge, AmyLayer, Caption, CardSkeleton, ColumnSkeleton, JobCount, RailCount, RightColumn, SheetBody, TodayList,
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

export function HomeClient({ shell, dataPromise, modules }: { shell: ShellData; dataPromise: Promise<HomeData>; modules: string[] }) {
  const rudi = useRef<RudiHandle | null>(null)
  const [state, setState] = useState<RudiState>('idle')
  const [minimised, setMinimised] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMobile = useIsMobile()

  // Two lines, never three: `said` is what the owner typed, echoed once; the reply REPLACES the
  // caption rather than appending to it. No transcript array — this screen is a presence, not a log.
  // What the owner said, and what she answered. Both come from the live session, and the caption is
  // where her answer goes — the big gradient line IS her voice, so a card repeating it over the
  // portrait was showing the same sentence twice and hiding the face to do it.
  const [said, setSaid] = useState<string | null>(null)
  const [reply, setReply] = useState<string | null>(null)
  const [asked, setAsked] = useState<string | null>(null)
  const [jump, setJump] = useState<number | null>(null)
  const [typing, setTyping] = useState(false)
  const [talkEl, setTalkEl] = useState<HTMLButtonElement | null>(null)
  const palette = usePalette()
  // AskAmy's session machine, verbatim — see components/dashboard/hero/use-amy-session.ts.
  const amy = useAmySession()
  useMagnet(talkEl, typing)

  // FIRST effect in the shell, so it fires as soon as React has hydrated this component — which is
  // the moment its click handlers become real. Anything before this and the button is inert markup.
  useEffect(() => { mark('shell'); startTiming() }, [])

  // Kept only to mark when the streamed numbers land, for the timing line.
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        await dataPromise
        // When the streamed numbers actually landed, for the timing line.
        mark('data')
        if (!alive) return
      } catch {
        // Swallowed deliberately: the Suspense boundaries consume the same promise and are what
        // surface a real failure to the owner.
      }
    })()
    return () => { alive = false }
  }, [dataPromise])

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

  // ── NOTHING HERE DRIVES THE CANVAS ────────────────────────────────────────────────────────────
  //
  // /v2 is a reskin. Its controls call the handlers /dashboard already has, or they do nothing — and
  // the canvas's listening / speaking / armed states are never triggered from this file. They exist
  // for the Deepgram agent to drive later, through the same API the component already exposes.
  //
  // The Talk button opens /dashboard's OWN live call. useAmySession is AskAmy's session machine,
  // lifted out of that component unchanged; goLive still unlocks the AudioContext inside the tap and
  // still renders <AmyRealtime>. The briefing is the one buildHeroInputs produces for /dashboard.
  // Nothing about the conversation is new — only which button starts it.
  const endSession = useCallback(() => { rudi.current?.endSession() }, [])

  const toggleTalk = useCallback(() => {
    wake()
    // Live already → this is the END the cursor promises, not a second session.
    if (amy.mode !== 'idle') { endSession(); amy.close(); setReply(null); return }
    amy.goLive()
  }, [wake, amy, endSession])

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

  // Typing hands off to AskAmyText — the same component "Type instead" opens on /dashboard, with the
  // same briefing. The echo stays: it is what the composer showed before the answer had anywhere to
  // come from, and it still reads as the owner's own line.
  const onSubmit = useCallback((text: string) => { setAsked(text); setSaid(text); amy.goText() }, [amy])

  // The portrait, driven by the session's own moments. Every branch calls a method the canvas already
  // exposes; nothing here decides anything about the conversation.
  const onMoment = useCallback((m: AmyMoment) => {
    const r = rudi.current
    if (!r) return
    if (m.type === 'listen') r.listen()
    else if (m.type === 'level') r.level(m.value)
    else if (m.type === 'speak') { setReply(m.text || null); r.speak(m.text, m.ms) }
    else if (m.type === 'stopSpeaking') r.stopSpeaking()
    else if (m.type === 'arm') r.arm()
    else if (m.type === 'said') { setSaid(m.text); setReply(null) }
    else if (m.type === 'reply') setReply(m.text)
  }, [])

  // Listening clears the caption; armed KEEPS her last sentence, because it is the thing being
  // answered. Only the resting line needs the numbers, so only that case can suspend.
  const override: RudiSegment[] | null =
    // NOT accented. .v2-cap is already white with the gradient reserved for <b>, and passing her whole
    // reply as one accented segment gradient-filled the entire sentence — which loses its middle over
    // any mid-tone part of the portrait. The gradient marks a clause; it is not a text colour.
    reply ? [{ text: reply }]
      : state === 'listening' ? []
        : state === 'speaking' ? [{ text: 'Rudi is speaking.', accent: true }] : null

  // Over the hero, never beside it: .v2-amy is absolutely positioned inside the stage, so it cannot
  // participate in the shell grid.
  const amyLayer = (
    <div className="v2-amy">
      <Suspense fallback={null}><AmyLayer p={dataPromise} session={amy} ask={asked} onMoment={onMoment} /></Suspense>
    </div>
  )

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
        <Cursor label={rudiCursor(state, minimised)} active={!typing && amy.mode === 'idle'} />
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
            // Gated exactly as /dashboard gates its tabs: no `pipeline`, no Leads row; no
            // `scheduling`, no Appointments row.
            ...(modules.includes('pipeline') ? [{ label: 'Leads', href: '/v2/leads', count: count((d) => d.railCounts.leads) }] : []),
            { label: 'Inbox', count: count((d) => d.railCounts.inbox) },
            ...(modules.includes('scheduling') ? [{ label: 'Appointments', count: count((d) => d.railCounts.appointments) }] : []),
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
            {amyLayer}
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
      <div className="v2-frame">{hero}{amyLayer}</div>
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
