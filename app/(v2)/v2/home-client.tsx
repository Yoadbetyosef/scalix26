'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RudiCanvas, type RudiHandle, type RudiState } from './rudi-canvas'
import { Composer } from './composer'
import { Rail } from './rail'
import { Sheet, type NeedsItem, type NowItem, type Tile } from './sheet'
import type { RudiSegment } from './rudi-line'
import { useIsMobile } from './use-breakpoint'

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
}

/** After this long with no interaction the hero collapses and the animation stops. */
const IDLE_MS = 60_000

/** How long the demo holds `listening` before Rudi answers. The reference's own value. */
const LISTEN_MS = 2500

/** The reference's three demo durations. Deliberately far apart so `speak(ms)` holding for EXACTLY
 *  ms is verifiable by watching: 2.2s is over before you finish reading, 15s is unmistakably long. */
const DEMO_MS = [2200, 6500, 15000]

export function HomeClient({ data }: { data: HomeData }) {
  const rudi = useRef<RudiHandle | null>(null)
  const [state, setState] = useState<RudiState>('idle')
  const [minimised, setMinimised] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const demoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMobile = useIsMobile()

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

  const toggleTalk = useCallback(() => {
    wake()
    const r = rudi.current
    if (!r) return
    if (demoTimer.current) { clearTimeout(demoTimer.current); demoTimer.current = null }

    if (r.state() === 'idle') {
      r.listen()
      // The demo chain, standing in for the voice layer: hold listening, then answer for one of three
      // durations. When the real layer arrives it calls Rudi.speak(text, ms) on the first audio chunk
      // and Rudi.stopSpeaking() when the stream ends, and this block is the only thing that goes.
      demoTimer.current = setTimeout(() => {
        demoTimer.current = null
        if (rudi.current?.state() !== 'listening') return
        const ms = DEMO_MS[Math.floor(Math.random() * DEMO_MS.length)]
        rudi.current.speak(undefined, ms)
      }, LISTEN_MS)
    } else {
      r.stopListening()
      r.stopSpeaking()
    }
  }, [wake])

  useEffect(() => () => { if (demoTimer.current) clearTimeout(demoTimer.current) }, [])

  // Space toggles, matching the SPACE affordance printed on the button. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.code === 'Space') { e.preventDefault(); toggleTalk() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleTalk])

  const caption = state === 'speaking'
    ? [{ text: 'Rudi is speaking.', accent: true } as RudiSegment]
    : state === 'listening' ? [] : data.line

  // ONE canvas, in ONE tree. See use-breakpoint.ts: rendering the hero into both trees and hiding one
  // with CSS gave two canvases racing for the same imperative ref, and the hidden one won.
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

  // Nothing until the breakpoint is measured — one frame of the wrong layout is worse than one frame
  // of none, and the canvas would size itself against a viewport it is about to leave.
  if (isMobile === null) return <div className="v2-app" aria-hidden />

  if (!isMobile) {
    return (
      <div className="v2-app">
        <Rail
          businessName={data.businessName}
          primary={data.rail.primary}
          groups={data.rail.groups}
          pulse={null}
          pulseLabel={null}
        />

        <main className="v2-stage" data-min={minimised || undefined}>
          <div className="v2-home">
            {hero}
            <div className="v2-overlay">
              {data.phone && <p className="v2-tag">Rudi · listening on {data.phone}</p>}
              <p className="v2-cap">
                {caption.map((s, i) => (s.accent ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
              </p>
              <Composer state={state} onTalk={toggleTalk} />
            </div>
          </div>

          {/* Revealed as the hero collapses. */}
          <div className="v2-dash" data-scroll>
            <h3>Recent</h3>
            {data.recent.length === 0
              ? <p style={{ fontSize: 15, color: 'var(--v2-ink-45)' }}>Nothing yet today.</p>
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
            ? <div className="v2-card"><p>Nothing on today</p><span>No appointments booked for today.</span></div>
            : data.rightNow.map((n) => (
              <div key={n.title} className="v2-card">
                <p>{n.title}</p>
                <span>{n.detail}</span>
              </div>
            ))}

          <div className="v2-blk">
            <p className="v2-kick" data-tone="warn"><i />Needs you{data.needsYou.length > 0 ? ` · ${data.needsYou.length}` : ''}</p>
            {data.needsYou.length === 0
              ? <div className="v2-card"><p>Nothing needs you</p><span>Every lead has been answered.</span></div>
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
        <Composer state={state} onTalk={toggleTalk} full />
      </div>
    </div>
  )
}
