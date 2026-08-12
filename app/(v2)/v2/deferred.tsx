'use client'
import { AmyRealtime, type AmyMoment } from '@/components/dashboard/hero/amy-realtime'
import { AskAmyText } from '@/components/dashboard/hero/ask-amy-text'
import type { AmySession } from '@/components/dashboard/hero/use-amy-session'

import { use } from 'react'
import type { HomeData } from './data'
import type { RudiSegment } from './rudi-line'
import { Sheet } from './sheet'

// The parts of the screen that need the numbers.
//
// Each one reads the SAME streamed promise through use(), and each sits inside its own <Suspense>, so
// they arrive independently and none of them can hold up the hero. The page never awaits this promise
// — it hands it over and returns, so the shell is interactive first.
//
// Every fallback below is the reference's own card style rather than a spinner. A skeleton shaped like
// the thing it is standing in for means the layout does not jump when the figures land; a spinner
// means it does.

export type P = Promise<HomeData>

// ── Skeletons ───────────────────────────────────────────────────────────────────────────────────────

/** A card-shaped placeholder. Same border, radius and shadow as the real thing. */
export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="v2-card v2-skel" aria-hidden>
      <span className="v2-skel-bar" style={{ width: '62%' }} />
      {lines > 1 && <span className="v2-skel-bar" style={{ width: '84%', marginTop: 8, height: 9 }} />}
    </div>
  )
}

export function ColumnSkeleton() {
  return (
    <>
      <p className="v2-kick"><i />Right now</p>
      <CardSkeleton />
      <div className="v2-blk">
        <p className="v2-kick"><i />Needs you</p>
        <CardSkeleton />
      </div>
      <div className="v2-blk">
        <p className="v2-kick"><i />This month</p>
        <div className="v2-big"><b className="v2-skel-num" aria-hidden /></div>
        <div className="v2-mini">
          <div className="v2-skel"><span className="v2-skel-bar" style={{ width: '48%', height: 18 }} /></div>
          <div className="v2-skel"><span className="v2-skel-bar" style={{ width: '48%', height: 18 }} /></div>
        </div>
      </div>
    </>
  )
}

// ── Deferred regions ────────────────────────────────────────────────────────────────────────────────

/** One rail count. Its own boundary with a null fallback, so labels render and figures pop in. */
export function RailCount({ p, pick }: { p: P; pick: (d: HomeData) => number | null }) {
  const v = pick(use(p))
  return v ? <em>{v}</em> : null
}

export function AiBadge({ p }: { p: P }) {
  return use(p).aiOn ? <em>ON</em> : null
}

/**
 * Rudi's line.
 *
 * `override` is whatever the conversation has put on screen — her reply, or nothing while listening.
 * It is rendered WITHOUT touching the promise, so a caption exists during a conversation even if the
 * figures have not landed. Only the resting line needs the numbers.
 */
export function Caption({ p, override }: { p: P; override: RudiSegment[] | null }) {
  const segs = override ?? use(p).line
  return (
    <p className="v2-cap">
      {segs.map((s, i) => (s.accent ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
    </p>
  )
}

export function RightColumn({ p }: { p: P }) {
  const d = use(p)
  return (
    <>
      <p className="v2-kick" data-tone="live"><i />Right now</p>
      {d.rightNow.length === 0
        ? <div className="v2-card" data-empty><p>Nothing on today</p><span>No appointments booked.</span></div>
        : d.rightNow.map((n) => (
          <div key={n.title} className="v2-card">
            <p>{n.title}</p>
            <span>{n.detail}</span>
          </div>
        ))}

      <div className="v2-blk">
        <p className="v2-kick" data-tone="warn"><i />Needs you{d.needsYou.length > 0 ? ` · ${d.needsYou.length}` : ''}</p>
        {d.needsYou.length === 0
          ? <div className="v2-card" data-empty><p>Nothing needs you</p><span>Every lead has been answered.</span></div>
          : d.needsYou.map((n) => (
            <button key={n.title} type="button" className="v2-card v2-item" disabled title="v2 preview">
              <p>{n.title}</p>
              <em>{n.detail}</em>
            </button>
          ))}
      </div>

      <div className="v2-blk">
        <p className="v2-kick"><i />This month · {d.monthLabel}</p>
        {d.monthStats.length > 0 && (
          <div className="v2-big">
            <b>{d.monthStats[0].value}</b>
            <span>{d.monthStats[0].label}</span>
          </div>
        )}
        {d.monthStats.length > 1 && (
          <div className="v2-mini">
            {d.monthStats.slice(1).map((s) => (
              <div key={s.label}><b>{s.value}</b><span>{s.label}</span></div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/** The collapsed view: Today, then what already happened. */
export function TodayList({ p }: { p: P }) {
  const d = use(p)
  return (
    <>
      <h3>Today</h3>
      {d.rightNow.length === 0
        ? <p className="v2-dempty">Nothing booked for today.</p>
        : d.rightNow.map((n) => (
          <button key={n.title} type="button" className="v2-dline" disabled title="v2 preview">
            <time>{n.detail.split(' · ')[0] || '—'}</time>
            <p>{n.title}</p>
          </button>
        ))}
      <h3 data-mt="true">Recent</h3>
      {d.recent.length === 0
        ? <p className="v2-dempty">Nothing yet today.</p>
        : d.recent.map((r, i) => (
          <button key={i} type="button" className="v2-dline" disabled title="v2 preview">
            <time>{r.time}</time>
            <p>{r.text}</p>
          </button>
        ))}
    </>
  )
}

export function SheetBody({ p }: { p: P }) {
  const d = use(p)
  return (
    <Sheet
      now={d.rightNow}
      needs={d.needsYou}
      tiles={d.tiles}
      monthLabel={d.monthLabel}
      monthStats={d.monthStats}
    />
  )
}

/** The mobile header's job count. */
export function JobCount({ p }: { p: P }) {
  return <>{use(p).rightNow.length.toString().padStart(2, '0')}</>
}


// ── THE VOICE LAYER, UNCHANGED ──────────────────────────────────────────────────────────────────────
//
// AmyRealtime and AskAmyText are the dashboard's own components, rendered here with the dashboard's
// own briefing. Nothing about the conversation is reimplemented — this file only reads the streamed
// promise so the session can start without the shell having awaited it.
//
// They carry their own (v1) styling. That is deliberate: restyling them would mean forking the voice
// UI, and a fork is the thing that drifts. The look is a separate, later decision.

export function AmyLayer({ p, session, ask, onMoment, onEnded }: { p: Promise<HomeData>; session: AmySession; ask?: string | null; onMoment?: (m: AmyMoment) => void; onEnded?: () => void }) {
  const briefing = use(p).briefing
  if (session.mode === 'live') {
    return <AmyRealtime briefing={briefing} audioCtx={session.audioCtx} onClose={() => { session.close(); onEnded?.() }} onType={session.goText} onMoment={onMoment} surface="v2" />
  }
  if (session.mode === 'text') return <AskAmyText briefing={briefing} onTalk={session.goLive} ask={ask} />
  return null
}
