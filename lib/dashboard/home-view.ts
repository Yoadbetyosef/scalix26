import type { getDashboardData } from './overview'
import type { getImpactData } from './impact'
import type { Arrivals } from '@/lib/inbox/arrivals'

// WHAT THE HOME SCREEN SHOWS, DERIVED ONCE.
//
// Lifted out of app/(v2)/v2/data.ts so /dashboard and /v2 read the same derivations rather than two
// copies that agree today. Same treatment, and the same reason, as buildHeroInputs: the values were
// trapped inside one screen's loader, and the second screen wanting the same picture had no way to
// ask for it.
//
// PURE. It takes what the caller already fetched — getDashboardData, getImpactData, loadArrivals —
// and adds no query of its own. Every comment below came with the code it explains.

export interface NowItem { title: string; detail: string; progress?: number | null }
export interface NeedsItem { title: string; detail: string; action: string }

export interface HomeView {
  /** The caption's inputs. Kept as inputs rather than a built sentence, so a live attention count can
   *  replace `waiting` on the client without re-deriving the rest. */
  line: { jobsToday: number; newToday: number; newHandled: number; waiting: number }
  waiting: number
  rightNow: NowItem[]
  needsYou: NeedsItem[]
  monthLabel: string
  monthStats: { label: string; value: string }[]
}

type Dash = Awaited<ReturnType<typeof getDashboardData>>
type Impact = Awaited<ReturnType<typeof getImpactData>>

/**
 * Only the two parts of the dashboard payload this actually reads.
 *
 * Narrower than the whole thing on purpose: the caller destructures what it needs from
 * getDashboardData and should not have to carry fields along just to satisfy a signature.
 */
type DashSlice = Pick<Dash, 'appointments_list'> & { stats: Pick<Dash['stats'], 'totalCalls'> }

export function buildHomeView(dash: DashSlice, impact: Impact, arrivals: Arrivals, waiting: number): HomeView {
  // Compared as date strings because slot_date is a plain date column, not a timestamp — converting
  // it through a Date would introduce a timezone the column does not have.
  const todayIso = new Date().toISOString().slice(0, 10)
  const todaysJobs = dash.appointments_list.filter(
    (a) => a.slot_date === todayIso && a.status !== 'cancelled',
  )

  const rightNow: NowItem[] = todaysJobs.map((a) => ({
    title: a.customer_name || 'Appointment',
    detail: [a.slot_time, a.service_type].filter(Boolean).join(' · ') || 'Booked',
  }))

  // ── ATTENTION NEEDED IS THE INBOX'S OWN TWO GROUPS ────────────────────────────────────────────
  //
  // It used to be two items, and both were wrong in the same direction — reporting handled work as
  // outstanding: `activeLeads` counts new+contacted and Speed-to-Lead sets `contacted` at the moment
  // it ANSWERS, so every arrival the AI dealt with in seconds appeared as unanswered; and
  // humanTakeoverCount is every takeover THIS MONTH, a month-long tally under a heading that says
  // "needs you now".
  //
  // These are the two groups the inbox itself puts in front of a person, which is the only definition
  // of outstanding this product has. If a row is here, opening the inbox shows the same row.
  const needsYou: NeedsItem[] = []
  if (arrivals.drafts > 0) {
    needsYou.push({
      title: `${arrivals.drafts} ${arrivals.drafts === 1 ? 'draft is' : 'drafts are'} waiting on you`,
      detail: 'Written and held for your decision before sending.',
      action: 'Open inbox',
    })
  }
  if (arrivals.unanswered > 0) {
    needsYou.push({
      title: `${arrivals.unanswered} ${arrivals.unanswered === 1 ? 'person is' : 'people are'} waiting for a reply`,
      detail: 'They wrote last and nothing has answered yet.',
      action: 'Open inbox',
    })
  }

  // getImpactData windows to the CURRENT MONTH and is labelled to match, rather than relabelled to
  // the design's "This week" — a month figure under a week heading is a wrong number wearing the
  // right word. Only figures that exist are pushed; the grid reflows around however many that is.
  const monthStats: { label: string; value: string }[] = [
    { label: 'Conversations managed', value: String(impact.conversationsManaged.value) },
    { label: 'Customers helped', value: String(impact.customersHelped.value) },
  ]
  if (impact.coveragePct.value !== null) {
    monthStats.push({ label: 'Answered', value: `${Math.round(impact.coveragePct.value)}%` })
  }
  monthStats.push({ label: 'After hours or handover', value: String(impact.opportunities.value) })
  // Calls moved here from the tile grid — a figure, among figures.
  if (dash.stats.totalCalls > 0) monthStats.push({ label: 'Calls answered', value: String(dash.stats.totalCalls) })

  return {
    line: { jobsToday: todaysJobs.length, newToday: arrivals.newToday, newHandled: arrivals.newHandled, waiting },
    waiting,
    rightNow,
    needsYou,
    monthLabel: impact.monthLabel,
    monthStats,
  }
}
