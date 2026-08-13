'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { RudiCanvas, type RudiHandle, type RudiState } from './rudi-canvas'
import { Composer } from './composer'
import { Rail } from './rail'
import { rudiCursor, type RudiSegment } from './rudi-line'
import { useIsMobile } from './use-breakpoint'
import { Cursor, Palette, useMagnet, usePalette } from './interactions'
import type { AmyMoment } from '@/components/dashboard/hero/amy-realtime'
import { replyLine } from './reply-line'
import { PRIMARY, allowed, visibleGroups } from './nav'
import { usePressState } from './use-press'
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
  // One listener for both surfaces — see use-press.ts.
  usePressState()
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
      // Desktop only. Collapsing exists to hand the centre column to the dashboard, and a phone has
      // no centre column to hand over — see collapse() below.
      if (rudi.current?.state() === 'idle') collapse()
    }, IDLE_MS)
  }, [])

  useEffect(() => {
    if (state === 'idle') kick()
    else if (idleTimer.current) clearTimeout(idleTimer.current)
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current) }
  }, [state, kick])

  // COLLAPSING IS A DESKTOP BEHAVIOUR. It shrinks the hero so the dashboard can take the centre
  // column; a phone has no centre column, so there is nothing for it to reveal and the collapsed
  // state was only ever a smaller portrait on an empty screen. On mobile a session simply ends and
  // she stays full-screen, back at the resting caption and the Talk button — the state it started in.
  const collapse = useCallback(() => { if (!isMobile) setMinimised(true) }, [isMobile])

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

  // Ending must be VISIBLE, not only in the socket. All four endings — the end button, ten seconds of
  // silence, a goodbye, a hidden tab — land here and collapse her to the corner tile, the same
  // collapse idle already performs. Clicking her expands and starts a new session, unchanged.
  const onEnded = useCallback(() => {
    rudi.current?.endSession()
    setReply(null)
    collapse()
  }, [collapse])


  const toggleTalk = useCallback(() => {
    wake()
    // Live already → this is the END the cursor promises, not a second session.
    if (amy.mode !== 'idle') { amy.close(); onEnded(); return }
    amy.goLive()
  }, [wake, amy, onEnded])

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
    else if (m.type === 'said') setSaid(m.text)
    else if (m.type === 'reply') setReply(m.text)
  }, [])

  // Listening clears the caption; armed KEEPS her last sentence, because it is the thing being
  // answered. Only the resting line needs the numbers, so only that case can suspend.
  const override: RudiSegment[] | null =
    // The gradient is emphasis, not a text colour: white by default, with at most one clause accented
    // — the part that needs an answer or an action. All-gradient lost the sentence's middle over the
    // portrait; all-white said nothing about which part mattered. See reply-line.ts.
    reply ? replyLine(reply)
      : state === 'listening' ? []
        : state === 'speaking' ? [{ text: 'Rudi is speaking.', accent: true }] : null

  // Over the hero, never beside it: .v2-amy is absolutely positioned inside the stage, so it cannot
  // participate in the shell grid.
  const amyLayer = (
    <div className="v2-amy">
      <Suspense fallback={null}><AmyLayer p={dataPromise} session={amy} ask={asked} onMoment={onMoment} onEnded={onEnded} /></Suspense>
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

  // ── ONE CANVAS, ONE POSITION ────────────────────────────────────────────────────────────────────
  //
  // The hero used to sit inside whichever branch was rendering — under .v2-home on desktop, under
  // .v2-frame on mobile — which are different positions in different parents. React reconciles by
  // position, so ANY change of branch destroyed the canvas and built a new one: the WebGL context, the
  // mesh, the still, the video, all discarded and refetched. That is what "effect running" a second
  // time was.
  //
  // It is now child 0 of a root that never changes, in both modes and while the breakpoint is still
  // unknown. The layouts differ AROUND it. That fixes the remount whatever triggers it, and it fixes
  // the real case this was always going to break on: crossing 720px, where the branch legitimately
  // does change and the canvas would have been thrown away every time.
  //
  // use-breakpoint.ts's constraint is intact — exactly ONE canvas exists and the ref is unambiguous.
  // This is not "one tree plus CSS"; it is one hero and two sets of chrome.
  const mode = isMobile === null ? 'pending' : isMobile ? 'mobile' : 'desktop'

  return (
    <div className="v2-root" data-mode={mode} data-min={minimised || undefined}>
      <div className="v2-hero">
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

      {mode === 'desktop' && (
        <div className="v2-app">
          <Cursor label={rudiCursor(state, minimised)} active={!typing && amy.mode === 'idle'} />
          <Palette
            commands={[
              ...['Leads', 'Inbox', 'Appointments', 'Contacts'].map((label, n) => ({ label, hint: String(n + 1) })),
              ...visibleGroups(modules).flatMap((g) => g.items.map((x) => ({ label: x.label, hint: g.label }))),
            ]}
            open={palette.open}
            onClose={palette.close}
          />

          <Rail
            businessName={shell.businessName}
            // From nav.ts, gated once. The mobile sheet reads the same list, so the only two
            // navigation surfaces in the product cannot drift apart — which they had, the sheet
            // being ten destinations short and carrying one that was not a destination.
            primary={allowed(PRIMARY, modules).map((d) => ({
              ...d,
              count: d.label === 'Leads' ? count((x) => x.railCounts.leads)
                : d.label === 'Inbox' ? count((x) => x.railCounts.inbox)
                  : d.label === 'Appointments' ? count((x) => x.railCounts.appointments) : undefined,
            }))}
            groups={visibleGroups(modules).map((g) => (g.id !== 'g1' ? g : {
              ...g,
              items: g.items.map((it) => (it.label !== 'AI Employees' ? it : {
                ...it,
                count: <Suspense fallback={null}><AiBadge p={dataPromise} /></Suspense>,
              })),
            }))}
            activeIndex={jump}
          />

          <main className="v2-stage" data-min={minimised || undefined}>
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
      )}

      {mode === 'mobile' && (
      <div className="v2-mobile">
        <div className="v2-top">
          <b>{shell.businessName}</b>
          <i><s /><Suspense fallback={<>&mdash;</>}><JobCount p={dataPromise} /></Suspense></i>
        </div>
        <Suspense fallback={null}>
          <SheetBody p={dataPromise} />
        </Suspense>
      </div>
      )}
    </div>
  )
}
