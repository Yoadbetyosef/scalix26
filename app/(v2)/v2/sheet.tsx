'use client'

import Link from 'next/link'

import { useState } from 'react'

// The mobile pull-up sheet: Now / Work / Week over the full-bleed hero.
//
// "Week" carries THIS MONTH's figures and is labelled accordingly — getImpactData windows to the
// current month and nothing here re-windows it. The segment keeps the reference's short label
// because the control is three words wide; the panel heading inside says what the data actually is.

export interface Tile { label: string; value: number | null; sub: string; href?: string }
export interface NeedsItem { title: string; detail: string; action: string }
export interface NowItem { title: string; detail: string; progress?: number | null }

interface Props {
  now: NowItem[]
  needs: NeedsItem[]
  tiles: Tile[]
  monthLabel: string
  monthStats: { label: string; value: string }[]
  groups: { id: string; label: string; items: { label: string; href?: string; out?: boolean }[] }[]
}

type Pane = 'now' | 'work' | 'week'

export function Sheet({ now, needs, tiles, groups, monthLabel, monthStats }: Props) {
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
            <>
              {/* The sheet is the ONLY navigation a phone has, so it carries every destination the
                  rail does — and in the rail's structure, because thirteen tiles in one grid is a
                  database, not a screen. The four that carry a count keep the tile treatment; the
                  rest are rows under their group heading.
                  A destination with no href has no screen yet and stays inert. It is never a link to
                  nothing. */}
              <div className="v2-tiles">
                {tiles.map((t) => (
                  t.href
                    ? (
                      <Link key={t.label} href={t.href} className="v2-tile">
                        {t.value !== null && <s>{t.value}</s>}
                        <b>{t.label}</b>
                        <i>{t.sub}</i>
                      </Link>
                    )
                    : (
                      <button key={t.label} type="button" className="v2-tile" disabled title="v2 preview">
                        {t.value !== null && <s>{t.value}</s>}
                        <b>{t.label}</b>
                        <i>{t.sub}</i>
                      </button>
                    )
                ))}
              </div>

              {/* A group whose rows were all gated away renders nothing — not a heading with a gap
                  under it. visibleGroups already drops empty groups; this makes the pane safe
                  regardless of what a caller hands it. */}
              {groups.filter((g) => g.items.length > 0).map((g) => (
                <div key={g.id}>
                  <p className="v2-kick" style={{ margin: '26px 0 10px' }}>{g.label}</p>
                  {g.items.map((d) => (
                    d.href
                      ? <Link key={d.label} href={d.href} className="v2-srow">{d.label}</Link>
                      : <button key={d.label} type="button" className="v2-srow" disabled title="v2 preview" data-out={d.out || undefined}>{d.label}</button>
                  ))}
                </div>
              ))}
            </>
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
