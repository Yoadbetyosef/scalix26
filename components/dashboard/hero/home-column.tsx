import type { HomeView } from '@/lib/dashboard/home-view'

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
// somewhere.

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

      <div className="v2-blk">
        <p className="v2-kick" data-tone="warn"><i />Needs you{view.needsYou.length > 0 ? ` · ${view.needsYou.length}` : ''}</p>
        {view.needsYou.length === 0
          ? <div className="v2-card" data-empty><p>Nothing needs you</p><span>Every lead has been answered.</span></div>
          : view.needsYou.map((n) => (
            <div key={n.title} className="v2-card v2-item">
              <p>{n.title}</p>
              <em>{n.detail}</em>
            </div>
          ))}
      </div>

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
