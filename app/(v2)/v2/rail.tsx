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
  /** Which primary row the 1-4 shortcut last selected. */
  activeIndex?: number | null
}

// The bottom pulse strip is deliberately ABSENT. It needs a 7-day series and a missed-call count, and
// the missed count has no source — logged under MISSING. Drawing it with invented bars would be the
// one thing on this screen that was not true.

const Chevron = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
)

function Nav({ item, on, shortcut }: { item: NavItem; on?: boolean; shortcut?: number }) {
  return (
    <button type="button" className="v2-nav" data-on={on || undefined} data-out={item.out || undefined}>
      <span>{item.label}</span>
      {item.badge ? <em>{item.badge}</em> : item.count ? <em>{item.count}</em> : null}
      {/* Revealed on hover — the shortcut is discoverable from the row it belongs to rather than from
          a help screen nobody opens. */}
      {shortcut && <span className="v2-kb">{shortcut}</span>}
    </button>
  )
}

export function Rail({ businessName, primary, groups, activeIndex = null }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({ [groups[0]?.id ?? '']: true })

  return (
    <aside className="v2-rail" data-scroll>
      <div className="v2-co">
        <b>{businessName}</b>
        <span><i />Rudi · on duty</span>
      </div>

      {primary.map((item, i) => (
        <Nav key={item.label} item={item} on={i === (activeIndex ?? 0)} shortcut={i + 1} />
      ))}

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

    </aside>
  )
}
