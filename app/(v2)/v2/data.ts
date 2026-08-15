import { createAdminClient } from '@/lib/supabase/server'
import { getDashboardData } from '@/lib/dashboard/overview'
import { getImpactData } from '@/lib/dashboard/impact'
import { loadArrivals, waitingCount } from '@/lib/inbox/arrivals'
import { buildHeroInputs } from '@/lib/dashboard/briefing'
import type { AmyBriefing } from '@/components/dashboard/hero/ask-amy-shared'
import { rudiLine, type RudiSegment } from './rudi-line'
import { PRIMARY, allowed, visibleGroups } from './nav'
import type { NeedsItem, NowItem, Tile } from './sheet'

// The numbers, loaded but NOT awaited by the page.
//
// ── WHY THIS IS A SEPARATE MODULE ───────────────────────────────────────────────────────────────────
//
// The page hands this function's PROMISE to the client and returns immediately, so the shell — hero,
// composer, rail — streams and is interactive before a single figure resolves. Measured, these two
// reused functions take 1-2s against the live database; that is 1-2s the owner used to spend looking
// at nothing, and none of it was ever the canvas (first draw: 24ms after mount).
//
// Nothing here optimises, caches, re-windows or rewrites a query. getDashboardData and getImpactData
// are called exactly as the dashboard calls them. The only thing that changed is WHEN the UI waits.

export interface ShellData {
  businessName: string
  phone: string | null
}

export interface HomeData {
  line: RudiSegment[]
  /** The exact briefing /dashboard hands AskAmy. Same helper, same inputs, no extra query. */
  briefing: AmyBriefing
  railCounts: { inbox: number | null; appointments: number | null }
  aiOn: boolean
  rightNow: NowItem[]
  needsYou: NeedsItem[]
  monthLabel: string
  monthStats: { label: string; value: string }[]
  tiles: Tile[]
  groups: { id: string; label: string; items: { label: string; href?: string; out?: boolean }[] }[]
  recent: { time: string; text: string }[]
}

/** The one row the shell itself needs. A single indexed lookup — fast enough to await. */
export async function loadShell(tenantId: string): Promise<ShellData> {
  const { data } = await createAdminClient()
    .from('tenants').select('business_name, phone_number').eq('id', tenantId).maybeSingle()
  return {
    businessName: (data?.business_name as string) || 'Your business',
    phone: (data?.phone_number as string) || null,
  }
}

export async function loadHomeData(tenantId: string, modules: string[] = []): Promise<HomeData> {
  const [dash, impact] = await Promise.all([
    getDashboardData(tenantId),
    getImpactData(tenantId),
  ])
  // Read after the two above because it needs the business timezone, which comes from the employee
  // rows they already loaded. Everything the home screen says about arrivals comes from here — see
  // lib/inbox/arrivals.ts for why it is the inbox's own grouping and not a second opinion.
  const arrivals = await loadArrivals(
    tenantId,
    (dash.aiEmployees[0] as { timezone?: string | null } | undefined)?.timezone ?? null,
  )
  const waiting = waitingCount(arrivals)

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
  // outstanding:
  //
  //   "N leads need an answer"      activeLeads counts new+contacted, and Speed-to-Lead sets
  //                                 `contacted` at the moment it ANSWERS. Every arrival the AI dealt
  //                                 with in seconds appeared here as unanswered.
  //   "N callers asked for a person" impact.humanTakeoverCount is every takeover THIS MONTH,
  //                                 including the ones long since dealt with — a month-long tally on
  //                                 a list headed "needs you now". It also double-counted: a
  //                                 taken-over thread whose customer spoke last is already in
  //                                 `needs` below.
  //
  // Now: the two groups the inbox itself puts in front of a person, which is the only definition of
  // outstanding this product has. If a row is here, opening the inbox shows the same row.
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
    line: rudiLine({ jobsToday: todaysJobs.length, newToday: arrivals.newToday, newHandled: arrivals.newHandled, waiting }),
    // Built from the data already loaded above — buildHeroInputs adds no query. This is what makes
    // the Talk button possible: the briefing was previously trapped inside the dashboard page.
    // `waitingOnYou` overrides the brief's "Leads awaiting follow-up" line, which read activeLeads —
    // the same wrong figure, spoken aloud when the owner asks how things are.
    briefing: {
      ...buildHeroInputs(dash.aiEmployees, impact, dash.appointments_list, dash.leads_list, dash.stats).briefing,
      waitingOnYou: waiting,
    },
    railCounts: {
      // WAS `totalConversations` — which, despite the name, counts INSTAGRAM AND FACEBOOK
      // conversations in the last seven days and nothing else. It computed to 0 on a tenant with 77
      // conversations, so the inbox badge was hidden entirely. A nav badge answers "how many need
      // you", so it is now the inbox's own two groups.
      inbox: waiting || null,
      appointments: todaysJobs.length || null,
    },
    aiOn: dash.aiEmployees.some((e) => (e as { is_active?: boolean }).is_active !== false),
    rightNow,
    needsYou,
    monthLabel: impact.monthLabel,
    monthStats,
    // The four primary destinations, hrefs and gating from nav.ts so the sheet and the rail cannot
    // disagree. 'Calls' used to sit here: it is a figure with no screen behind it, so it moved to the
    // Week pane where figures belong and stopped pretending to be somewhere you could go.
    tiles: allowed(PRIMARY, modules).map((d) => {
      const n = {
        Inbox: { value: waiting || null, sub: waiting ? 'waiting on you' : 'nothing waiting' },
        Appointments: { value: todaysJobs.length || null, sub: 'today' },
        Contacts: { value: null, sub: 'address book' },
      }[d.label] ?? { value: null, sub: '' }
      return { label: d.label, href: d.href, ...n }
    }),
    groups: visibleGroups(modules),
    recent: dash.conversations.slice(0, 8).map((c) => {
      const conv = c as { updated_at?: string; channel?: string; contact?: { name?: string } | null }
      const when = conv.updated_at ? new Date(conv.updated_at) : null
      return {
        time: when ? when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '',
        text: `${conv.contact?.name || 'Someone'} · ${conv.channel || 'message'}`,
      }
    })
  }
}
