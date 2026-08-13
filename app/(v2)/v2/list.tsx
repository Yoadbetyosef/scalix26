'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { RudiSegment } from './rudi-line'
// From a NON-client module, so the server routes can call channelKey() too — see channels.ts.
export { channelKey, type ChannelKey } from './channels'
import type { ChannelKey } from './channels'

// THE LIST PAGE — one component for Leads, Inbox, Contacts, Orders and Appointments.
//
// The mobile and desktop references draw #p-leads and #p-inbox with byte-identical row markup and
// differ only in the words: an opening line, a strip of chips, then rows of name / detail / figure.
// That is why this is one component and not five. If a caller ever needs a branch in here for its own
// screen, the shape is wrong — the fix is a new field on ListRow, not an `if (kind === 'leads')`.
//
// ── FILTERING WITHOUT PREDICATES ────────────────────────────────────────────────────────────────────
//
// A filter cannot be a function: these rows are built on the server and a function does not cross that
// boundary. So a row states which BUCKET it is in — its own status, whatever that means for the screen
// — and a chip states which buckets it shows. Counts are derived here from the rows, never passed in,
// so a chip can never claim a number the list does not contain.

export interface ListAction {
  label: string
  tone?: 'primary' | 'quiet'
  /** Present = rendered disabled, with this as the title. The v2 preview disables every action. */
  disabledReason?: string
}

export interface ListRow {
  id: string
  /** The name a person scans for. */
  primary: string
  /** One line beneath it: everything that is neither the name nor the trailing figure. */
  detail: string
  /** The right-hand figure — a time, an amount, a count. Monospace, as the reference sets it. */
  trailing?: string | null
  trailingTone?: 'positive' | null
  /** The attention marker: the small dot at the row's leading edge. */
  marked?: boolean
  /** Dimmed — present but settled, e.g. dismissed. */
  muted?: boolean
  /** Where the row goes. Absent = not clickable, which is a real state: not every row has a thread. */
  href?: string | null
  /** Which bucket this row is in. Chips select by bucket. */
  bucket: string
  /** How this row reached the business. Drives a coloured mark so the eye sorts without reading. */
  channel?: ChannelKey | null
  /** This row needs a person. THE accent on a list — nothing else competes for it. */
  needsYou?: boolean
  actions?: ListAction[]
}

export interface ListFilter {
  id: string
  label: string
  /** The buckets this chip shows. Its count is computed from the rows, not supplied. */
  buckets: string[]
}

export interface ListPageProps {
  title: string
  /** The opening line, in the caption's own segment form so the accent renders as an element. */
  line: RudiSegment[]
  filters: ListFilter[]
  initialFilter?: string
  rows: ListRow[]
  /** Shown when there is nothing at all, in any bucket. */
  empty: { title: string; body: string }
  backHref?: string
  /** The selected row's detail, rendered beside the list above 1100px. Absent = single column. */
  detail?: ReactNode
  /** Which row is selected, so the list can mark it. */
  selectedId?: string | null
}

const Chevron = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
)

// TWO PANES ABOVE 1100px. Below it there is not room for a list and a record side by side, and the row
// simply navigates as it always did. The breakpoint is read in JS rather than CSS because it changes
// what a click DOES, not just how it looks: wide, a row selects and the pane re-renders; narrow, a row
// is a link to a page.
const WIDE_QUERY = '(min-width: 1100px)'

function useWide(): boolean {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const apply = () => setWide(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return wide
}

export function ListPage({ title, line, filters, initialFilter, rows, empty, backHref, detail, selectedId }: ListPageProps) {
  const router = useRouter()
  const wide = useWide()
  const twoPane = wide && detail !== undefined
  const [active, setActive] = useState(initialFilter ?? filters[0]?.id ?? '')

  // Every chip's count, and the rows the selected one shows. One pass, so a chip's number and the list
  // beneath it are derived from the same array on the same render and cannot disagree.
  const { counts, visible } = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const f of filters) counts[f.id] = 0
    for (const r of rows) for (const f of filters) if (f.buckets.includes(r.bucket)) counts[f.id]++
    const sel = filters.find((f) => f.id === active) ?? filters[0]
    return { counts, visible: sel ? rows.filter((r) => sel.buckets.includes(r.bucket)) : rows }
  }, [rows, filters, active])

  return (
    <div className="v2-page" data-two={twoPane || undefined}>
      <header className="v2-phd">
        {backHref && (
          <button type="button" onClick={() => router.push(backHref)} className="v2-bk" aria-label="Back">
            <Chevron />
          </button>
        )}
        <h2>{title}</h2>
      </header>

      <div className="v2-pbody" data-scroll>
        {rows.length === 0 ? (
          <div className="v2-pempty">
            <p className="v2-pempty-t">{empty.title}</p>
            <p className="v2-pempty-b">{empty.body}</p>
          </div>
        ) : (
          <>
            <p className="v2-lin">
              {line.map((s, i) => (s.accent ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
            </p>

            <div className="v2-chips">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="v2-chip"
                  data-on={f.id === active || undefined}
                  onClick={() => setActive(f.id)}
                >
                  {f.label}
                  {/* A zero is never drawn. The reference only ever shows a figure when there is one,
                      and a row of zeroes reads as a dead product. */}
                  {counts[f.id] > 0 && <i>{counts[f.id]}</i>}
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <p className="v2-pnone">Nothing here.</p>
            ) : (
              <div className="v2-stagger">
              {visible.map((r) => (
                <div
                  key={r.id}
                  className="v2-row"
                  data-muted={r.muted || undefined}
                  data-needs={r.needsYou || undefined}
                  data-click={r.href ? true : undefined}
                  data-selected={r.id === selectedId || undefined}
                  data-touch={r.href ? true : undefined}
                  onClick={r.href ? () => {
                    // Wide: select, and the pane beside the list re-renders. Narrow: go to the page.
                    // replace() rather than push() so the back button leaves the list rather than
                    // walking back through every row that was looked at.
                    if (twoPane) router.replace(`?open=${r.id}`, { scroll: false })
                    else router.push(r.href!)
                  } : undefined}
                >
                  {r.marked && <span className="v2-dot" aria-hidden />}
                  {/* Same shape and weight for every channel; only the hue differs. */}
                  {r.channel && <span className="v2-chan" data-channel={r.channel} title={r.channel} aria-hidden />}
                  <div className="v2-m">
                    <p>{r.primary}</p>
                    <span>{r.detail}</span>
                  </div>

                  {r.actions?.length ? (
                    <div className="v2-racts">
                      {r.actions.map((a) => (
                        <button
                          key={a.label}
                          type="button"
                          className="v2-ract"
                          data-tone={a.tone ?? 'quiet'}
                          disabled={!!a.disabledReason}
                          title={a.disabledReason}
                          // The row navigates; an action inside it must not, even disabled.
                          onClick={(e) => e.stopPropagation()}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {r.trailing && <em data-tone={r.trailingTone ?? undefined}>{r.trailing}</em>}
                </div>
              ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* The right pane. Only mounted when the layout is actually two panes, so a narrow viewport
          never renders a record nobody can see. */}
      {twoPane && <div className="v2-pane">{detail ?? <p className="v2-pnone">Pick something on the left.</p>}</div>}
    </div>
  )
}
