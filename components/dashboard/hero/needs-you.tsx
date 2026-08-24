'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { useAttention } from '@/components/dashboard/attention'
import { attentionStore } from '@/lib/dashboard/attention-store'
import { DrillDownDrawer, type DrawerConfig } from '@/components/dashboard/drill-down-drawer'
import type { AttentionItem } from '@/lib/dashboard/impact'
import type { NeedsItem } from '@/lib/dashboard/home-view'

/**
 * NEEDS YOU — one list, where there used to be two that disagreed.
 *
 * Until now this column rendered `view.needsYou` (the inbox's own arrivals: held drafts and
 * unanswered people) and a SEPARATE amber "Attention Needed" banner sat below the hero rendering
 * the notification queue. On Smith Hvac that produced a right column saying "Nothing needs you —
 * every lead has been answered" directly above a banner listing seven conversations and two leads.
 * An empty state shown over a non-empty queue.
 *
 * So both are here, and the empty card appears only when BOTH are empty.
 *
 * ── WHY THE CAPTION STILL COUNTS SOMETHING ELSE, AND THAT IS NOT THE OLD BUG ───────────────────
 *
 * The hero's accented clause counts `waiting`, and attention-store.ts says why in its own comment:
 * `waiting` is the inbox's two groups — what is outstanding RIGHT NOW — while `unresolvedCount`
 * counts notifications, which include month-long tallies like "7 conversations you're handling
 * personally". "Nothing needs you right now" above a standing tally of takeovers is two true
 * statements about two different spans. What was NOT compatible was an empty state over a full
 * queue, and that is what is fixed here.
 *
 * The store is the live source, so a dismiss anywhere updates this the same frame.
 */
export function NeedsYou({ fallback, className, anchor, hideLabel }: {
  fallback: NeedsItem[]; className?: string; anchor?: boolean
  /** The drawer puts the label in its own header row beside the close button, so the list omits it. */
  hideLabel?: boolean
}) {
  const { ready, visibleItems } = useAttention()
  const [drawer, setDrawer] = useState<DrawerConfig | null>(null)

  // Before hydration the store is empty; the server's arrivals rows are what there is to show, and
  // showing them avoids the column flashing from empty to full.
  const attention = ready ? visibleItems : []
  const total = attention.length + fallback.length

  const openMetric = (item: AttentionItem) => {
    const n = parseInt(item.label, 10) || 0
    const meta = item.metric === 'attention_takeover'
      ? { title: "Conversations You're Handling", subtitle: "Open conversations you've stepped into." }
      : { title: 'Leads Awaiting Follow-up', subtitle: "Leads that haven't been contacted yet." }
    setDrawer({ metric: item.metric!, title: meta.title, subtitle: meta.subtitle, headerCount: `${n}` })
  }

  return (
    // The anchor belongs to exactly one instance. The column carries it; the copy the mobile pill
    // opens in a drawer must not, or the page has two elements with the same id and the bell's
    // deep-link lands on whichever the browser finds first.
    <div className={className} id={anchor ? 'attention-needed' : undefined}>
      {!hideLabel && <p className="v2-kick" data-tone="warn"><i />Needs you{total > 0 ? ` · ${total}` : ''}</p>}

      {total === 0 ? (
        <div className="v2-card" data-empty><p>Nothing needs you</p><span>Every lead has been answered.</span></div>
      ) : (
        <>
          {/* The notification queue. Each row goes where v1's banner sent it — the drill-down for a
              metric row, the href otherwise — and keeps the dismiss it had. Dismiss is not resolve:
              it marks the notification seen, per tenant, and leaves the business state alone. */}
          {attention.map((item) => {
            const body = <span className="v2-nlab">{item.label}</span>
            return (
              <div key={item.metric || item.label} className="v2-card v2-need">
                {item.metric
                  ? <button type="button" className="v2-nhit" onClick={() => openMetric(item)}>{body}</button>
                  : <Link href={item.href} className="v2-nhit">{body}</Link>}
                <button
                  type="button"
                  className="v2-nx"
                  onClick={() => attentionStore.dismiss(item)}
                  aria-label={`Dismiss: ${item.label}`}
                >
                  <X />
                </button>
              </div>
            )
          })}

          {/* The inbox's own arrivals. Not links, and deliberately so — the same note the column
              carried before: they are not buttons until they lead somewhere. */}
          {fallback.map((n) => (
            <div key={n.title} className="v2-card v2-item">
              <p>{n.title}</p>
              <em>{n.detail}</em>
            </div>
          ))}
        </>
      )}

      <DrillDownDrawer config={drawer} onClose={() => setDrawer(null)} />
    </div>
  )
}
