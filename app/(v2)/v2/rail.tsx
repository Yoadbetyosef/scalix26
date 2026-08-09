'use client'

import { useState } from 'react'

// The left rail: business identity, the four primary destinations with their counts, three
// collapsible groups, and the pulse strip pinned to the bottom.
//
// Counts come from the page as real numbers. A destination with nothing waiting shows no count at
// all rather than a zero — the reference only ever shows a figure when there is one, and a column of
// zeroes reads as a dead product.

interface NavItem { label: string; count?: number | null; badge?: string; out?: boolean }
interface Group { id: string; label: string; items: NavItem[] }

interface Props {
  businessName: string
  primary: NavItem[]
  groups: Group[]
  /** Seven bars, newest last. Null when the series does not exist. */
  pulse?: number[] | null
  pulseLabel?: string | null
}

const Chevron = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
)

function Nav({ item, on }: { item: NavItem; on?: boolean }) {
  return (
    <button type="button" className="v2-nav" data-on={on || undefined} data-out={item.out || undefined}>
      <span>{item.label}</span>
      {item.badge ? <em>{item.badge}</em> : item.count ? <em>{item.count}</em> : null}
    </button>
  )
}

export function Rail({ businessName, primary, groups, pulse, pulseLabel }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({ [groups[0]?.id ?? '']: true })

  return (
    <aside className="v2-rail" data-scroll>
      <div className="v2-co">
        <b>{businessName}</b>
        <span><i />Rudi · on duty</span>
      </div>

      {primary.map((item, i) => <Nav key={item.label} item={item} on={i === 0} />)}

      {groups.map((g) => (
        <div key={g.id}>
          <button
            type="button"
            className="v2-gh"
            data-open={open[g.id] || undefined}
            onClick={() => setOpen((p) => ({ ...p, [g.id]: !p[g.id] }))}
            aria-expanded={!!open[g.id]}
          >
            <span>{g.label}</span>
            <Chevron />
          </button>
          <div className="v2-sub" data-open={open[g.id] || undefined}>
            {g.items.map((item) => <Nav key={item.label} item={item} />)}
          </div>
        </div>
      ))}

      {/* The pulse strip. Rendered only when there is a real series behind it — see MISSING. */}
      {pulse && pulse.length > 0 && (
        <div className="v2-pulse">
          <div className="v2-spark">
            {pulse.map((h, i) => (
              <i key={i} data-on={i === pulse.length - 1 || undefined} style={{ height: `${Math.max(6, h)}%` }} />
            ))}
          </div>
          {pulseLabel && <p>{pulseLabel}</p>}
        </div>
      )}
    </aside>
  )
}
