'use client'

import Link from 'next/link'
import { useSignOut } from './sign-out'
import { useState, type ReactNode } from 'react'
import {
  TrendingUp, MessageSquare, Calendar, Users, Bot, BookLock, FlaskConical,
  Package, BarChart3, FileText, CreditCard, Settings, Plug, LogOut,
} from 'lucide-react'

// The same map the sheet draws from — one label, one mark, both widths.
const ICONS: Record<string, typeof TrendingUp> = {
  Leads: TrendingUp, Inbox: MessageSquare, Appointments: Calendar, Contacts: Users,
  'AI Employees': Bot, Knowledge: BookLock, 'Test AI': FlaskConical,
  Orders: Package, Analytics: BarChart3, Reports: FileText,
  Billing: CreditCard, Settings, Connections: Plug, 'Sign Out': LogOut,
}
// RUDI magenta, BUSINESS violet, ACCOUNT cyan — the sheet's own assignment.
const GROUP_HUE: Record<string, string> = { g1: 'var(--v2-t1)', g2: 'var(--v2-t3)', g3: 'var(--v2-t4)' }

// The left rail: business identity, the four primary destinations with their counts, three
// collapsible groups, and the pulse strip pinned to the bottom.
//
// Counts come from the page as real numbers. A destination with nothing waiting shows no count at
// all rather than a zero — the reference only ever shows a figure when there is one, and a column of
// zeroes reads as a dead product.

// `count` is a ReactNode, not a number: each one is its own <Suspense> boundary supplied by the
// shell, so the labels render immediately and the figures pop in as the data streams.
interface NavItem { label: string; count?: ReactNode; out?: boolean; href?: string; action?: 'signout' }
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

function Nav({ item, on, shortcut, signOut }: { item: NavItem; on?: boolean; shortcut?: number; signOut: () => void }) {
  // Only a row with a built destination navigates. The rest stay buttons that do nothing, which is
  // what they were — a link to a page that does not exist is a worse lie than an inert row.
  // Only a row with a built destination navigates. The rest stay buttons that do nothing, which is
  // what they were — a link to a page that does not exist is a worse lie than an inert row. Written as
  // two branches rather than a dynamic tag because Link's props are not a superset of button's, and
  // the union that satisfies both is less readable than saying it twice.
  const Icon = ICONS[item.label]
  const inner = (
    <>
      {/* The same 32px chip the sheet uses, at 10% of the group's hue. Primary rows carry the accent's
          first sample, since they belong to no group. */}
      {Icon && <span className="v2-gchip"><Icon /></span>}
      <span className="v2-glab">{item.label}</span>
      {item.count ?? null}
      {/* Revealed on hover — the shortcut is discoverable from the row it belongs to rather than from
          a help screen nobody opens. */}
      {shortcut && <span className="v2-kb">{shortcut}</span>}
    </>
  )
  const attrs = { className: 'v2-nav v2-grow', 'data-touch': true, 'data-on': on || undefined, 'data-out': item.out || undefined }
  // An action row is a live button, not a link and not an inert one.
  if (item.action === 'signout') return <button type="button" {...attrs} onClick={signOut}>{inner}</button>
  return item.href
    ? <Link href={item.href} {...attrs}>{inner}</Link>
    : <button type="button" {...attrs}>{inner}</button>
}

export function Rail({ businessName, primary, groups, activeIndex = null }: Props) {
  const signOut = useSignOut()
  const [open, setOpen] = useState<Record<string, boolean>>({ [groups[0]?.id ?? '']: true })

  return (
    <aside className="v2-rail" data-scroll>
      <div className="v2-co">
        <b>{businessName}</b>
        <span><i />Rudi · on duty</span>
      </div>

      <div className="v2-stagger" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
        {primary.map((item, i) => (
          <Nav key={item.label} item={item} on={i === (activeIndex ?? 0)} shortcut={i + 1} signOut={signOut} />
        ))}
      </div>

      {groups.map((g) => (
        <div key={g.id} style={{ ['--ghue' as string]: GROUP_HUE[g.id] ?? 'var(--v2-t3)' }}>
          <button
            type="button"
            className="v2-gh"
            data-open={open[g.id] || undefined}
            onClick={() => setOpen((p) => ({ ...p, [g.id]: !p[g.id] }))}
            aria-expanded={!!open[g.id]}
          >
            {/* Dot, label, then a rule that fades out in the group's own colour — the sheet's header,
                with the rail's chevron kept because these groups collapse. */}
            <i className="v2-gdot" />
            <span>{g.label}</span>
            <s className="v2-grule" />
            <Chevron />
          </button>
          <div className="v2-sub" data-open={open[g.id] || undefined}>
            {g.items.map((item) => <Nav key={item.label} item={item} signOut={signOut} />)}
          </div>
        </div>
      ))}

    </aside>
  )
}
