import type { HomeView } from '@/lib/dashboard/home-view'
import { NeedsYou } from './needs-you'

// /v2's right-hand column, on v1's data.
//
// The markup is RightColumn from app/(v2)/v2/deferred.tsx, unchanged — same elements, same classes,
// same empty states, same order. What differs is where the values come from: a HomeView built by
// lib/dashboard/home-view.ts out of the two queries the dashboard already ran plus the inbox's own
// arrivals grouping, rather than /v2's streamed HomeData promise.
//
// The one thing deliberately not carried over is `disabled title="v2 preview"` on the Needs You rows.
// /v2 is a preview and its rows go nowhere; this is the product, and a button that does nothing is
// worse here than a row that is plainly not a button yet. They are not buttons until they lead
// somewhere — which is still true of the arrivals rows, and no longer true of the notification
// rows beside them, which now go exactly where the amber banner used to send them.

export function HomeColumn({ view }: { view: HomeView }) {
  return (
    <>
      <p className="v2-kick" data-tone="live"><i />Right now</p>
      {view.rightNow.length === 0
        ? <div className="v2-card" data-empty><p>Nothing on today</p><span>No appointments booked.</span></div>
        : view.rightNow.map((n) => (
          <div key={n.title} className="v2-card">
            <p>{n.title}</p>
            <span>{n.detail}</span>
          </div>
        ))}

      {/* NEEDS YOU is a client island now: it reads the attention store so a dismiss anywhere in
          the app updates it the same frame, which the amber banner below the hero used to do and
          this column did not. It also carries the #attention-needed anchor the notification bell
          and the voice assistant deep-link to — that anchor moved here with the list. */}
      <NeedsYou className="v2-blk" fallback={view.needsYou} anchor />

      <div className="v2-blk">
        <p className="v2-kick"><i />This month · {view.monthLabel}</p>
        {view.monthStats.length > 0 && (
          <div className="v2-big">
            <b>{view.monthStats[0].value}</b>
            <span>{view.monthStats[0].label}</span>
          </div>
        )}
        {view.monthStats.length > 1 && (
          <div className="v2-mini">
            {view.monthStats.slice(1).map((s) => (
              <div key={s.label}><b>{s.value}</b><span>{s.label}</span></div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
