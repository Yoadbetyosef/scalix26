'use client'

import Link from 'next/link'
import {
  TrendingUp, MessageSquare, Calendar, Users, Bot, BookLock, FlaskConical,
  Package, BarChart3, FileText, CreditCard, Settings, Plug, LogOut, ChevronRight,
} from 'lucide-react'

import { useState } from 'react'

// The mobile pull-up sheet: Now / Work / Week over the full-bleed hero.
//
// "Week" carries THIS MONTH's figures and is labelled accordingly — getImpactData windows to the
// current month and nothing here re-windows it. The segment keeps the reference's short label
// because the control is three words wide; the panel heading inside says what the data actually is.

export interface Tile { label: string; value: number | null; sub: string; href?: string }

// Presentation only — a label to a mark. No destination, no data, nothing the nav does not already
// know; this file simply draws what nav.ts lists.
const ICONS: Record<string, typeof TrendingUp> = {
  Leads: TrendingUp, Inbox: MessageSquare, Appointments: Calendar, Contacts: Users,
  'AI Employees': Bot, Knowledge: BookLock, 'Test AI': FlaskConical,
  Orders: Package, Analytics: BarChart3, Reports: FileText,
  Billing: CreditCard, Settings, Connections: Plug, 'Sign Out': LogOut,
}
// Which sample of the accent a group wears. The heading dot, its fading rule and every icon chip
// inside the card read from this one value.
const GROUP_HUE: Record<string, string> = { g1: 'var(--v2-t1)', g2: 'var(--v2-t3)', g3: 'var(--v2-t4)' }
export interface NeedsItem { title: string; detail: string; action: string }
export interface NowItem { title: string; detail: string; progress?: number | null }

interface Props {
  now: NowItem[]
  needs: NeedsItem[]
  tiles: Tile[]
  monthLabel: string
  monthStats: { label: string; value: string }[]
  /** The agent is answering right now. Existing data — HomeData.aiOn. */
  live?: boolean
  groups: { id: string; label: string; items: { label: string; href?: string; out?: boolean }[] }[]
}

type Pane = 'now' | 'work' | 'week'

export function Sheet({ now, needs, tiles, groups, monthLabel, monthStats, live }: Props) {
  const [open, setOpen] = useState(false)

  const [pane, setPane] = useState<Pane>('now')

  return (
    <>
      {!open && (
        <button
          type="button"
          className="v2-grab"
          onClick={() => setOpen(true)}
          style={{ pointerEvents: 'auto', background: 'none' }}
          aria-label="Open dashboard"
        >
          <s />
          <span>Swipe up</span>
        </button>
      )}

      <div className="v2-sheet" data-open={open || undefined}>
        <button type="button" className="v2-sh" onClick={() => setOpen((v) => !v)} aria-label={open ? 'Close' : 'Open'}>
          <s />
        </button>

        <div className="v2-segs">
          {(['now', 'work', 'week'] as Pane[]).map((p) => (
            <button key={p} type="button" data-on={pane === p || undefined} onClick={() => setPane(p)}>
              {p === 'now' ? 'Now' : p === 'work' ? 'Work' : 'Week'}
            </button>
          ))}
        </div>

        <div className="v2-sin" data-scroll>
          {pane === 'now' && (
            <>
              <p className="v2-kick" data-tone="live"><i />Right now</p>
              {now.length === 0
                ? <p className="v2-done">Nothing on today.</p>
                : now.map((n) => (
                  <div key={n.title} className="v2-lcard">
                    <h4>{n.title}</h4>
                    <p>{n.detail}</p>
                  </div>
                ))}

              <p className="v2-kick" data-tone="warn" style={{ marginTop: 26 }}>
                <i />Needs you{needs.length > 0 ? ` · ${needs.length}` : ''}
              </p>
              {needs.length === 0
                ? <p className="v2-done">Nothing needs you.</p>
                : needs.map((n) => (
                  <div key={n.title} className="v2-lcard">
                    <h4>{n.title}</h4>
                    <p>{n.detail}</p>
                    <div className="v2-acts">
                      <button type="button" className="v2-pri" disabled title="v2 preview">{n.action}</button>
                      <button type="button" className="v2-gho" disabled title="v2 preview">Open</button>
                    </div>
                  </div>
                ))}
            </>
          )}

          {pane === 'work' && (
            <div className="v2-stagger">
              {/* Live is TRANSIENT state, so it is absent whenever the agent is not answering. The
                  green never sits on this screen decoratively. */}
              {live && (
                <p className="v2-livepill"><i />On duty</p>
              )}

              <div className="v2-tiles">
                {tiles.map((t, i) => {
                  const inner = (
                    <>
                      <span className="v2-tnum">
                        {/* The highlighter, behind the numeral — only when there is something new. */}
                        {t.value !== null && t.value > 0 && <em className="v2-marker" aria-hidden />}
                        <b>{t.value ?? '—'}</b>
                      </span>
                      <span className="v2-tlab">{t.label}</span>
                      <span className="v2-tsub">{t.sub}</span>
                    </>
                  )
                  const props = { className: 'v2-tile2', 'data-t': i + 1, 'data-touch': true }
                  return t.href
                    ? <Link key={t.label} href={t.href} {...props}>{inner}</Link>
                    : <button key={t.label} type="button" disabled title="v2 preview" {...props}>{inner}</button>
                })}
              </div>

              {groups.filter((g) => g.items.length > 0).map((g) => (
                <div key={g.id} className="v2-group" style={{ ['--ghue' as string]: GROUP_HUE[g.id] ?? 'var(--v2-t3)' }}>
                  <p className="v2-ghead"><i />{g.label}<s /></p>
                  <div className="v2-gcard">
                    {g.items.map((d) => {
                      const Icon = ICONS[d.label] ?? ChevronRight
                      const inner = (
                        <>
                          <span className="v2-gchip"><Icon /></span>
                          <span className="v2-glab">{d.label}</span>
                          <span className="v2-gtrail"><ChevronRight className="v2-gchev" /></span>
                        </>
                      )
                      const props = { className: 'v2-grow', 'data-touch': true, 'data-out': d.out || undefined }
                      return d.href
                        ? <Link key={d.label} href={d.href} {...props}>{inner}</Link>
                        // Deliberately locked, not broken: no chevron, a muted chip, and it says why.
                        : <button key={d.label} type="button" disabled title="v2 preview" {...props}>{inner}</button>
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {pane === 'week' && (
            <>
              <p className="v2-kick" style={{ marginBottom: 14 }}>This month · {monthLabel}</p>
              <div className="v2-tiles">
                {monthStats.map((s) => (
                  <div key={s.label} className="v2-tile">
                    <s>{s.value}</s>
                    <b>{s.label}</b>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
