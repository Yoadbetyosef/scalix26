import { createAdminClient } from '@/lib/supabase/server'
import { getDashboardData } from '@/lib/dashboard/overview'
import { getImpactData } from '@/lib/dashboard/impact'
import { buildHeroInputs } from '@/lib/dashboard/briefing'
import type { AmyBriefing } from '@/components/dashboard/hero/ask-amy-shared'
import { rudiLine, type RudiSegment } from './rudi-line'
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
  railCounts: { leads: number | null; inbox: number | null; appointments: number | null }
  aiOn: boolean
  rightNow: NowItem[]
  needsYou: NeedsItem[]
  monthLabel: string
  monthStats: { label: string; value: string }[]
  tiles: Tile[]
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

export async function loadHomeData(tenantId: string): Promise<HomeData> {
  const [dash, impact] = await Promise.all([
    getDashboardData(tenantId),
    getImpactData(tenantId),
  ])

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

  const unansweredLeads = dash.stats.activeLeads
  const humanRequested = impact.humanTakeoverCount

  const needsYou: NeedsItem[] = []
  if (unansweredLeads > 0) {
    needsYou.push({
      title: `${unansweredLeads} ${unansweredLeads === 1 ? 'lead needs' : 'leads need'} an answer`,
      detail: 'New or contacted, not yet booked or dismissed.',
      action: 'Open leads',
    })
  }
  if (humanRequested > 0) {
    needsYou.push({
      title: `${humanRequested} ${humanRequested === 1 ? 'caller' : 'callers'} asked for a person`,
      detail: 'Rudi handed these over rather than answering.',
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

  return {
    line: rudiLine({ jobsToday: todaysJobs.length, unansweredLeads, humanRequested }),
    // Built from the data already loaded above — buildHeroInputs adds no query. This is what makes
    // the Talk button possible: the briefing was previously trapped inside the dashboard page.
    briefing: buildHeroInputs(dash.aiEmployees, impact, dash.appointments_list, dash.leads_list, dash.stats).briefing,
    railCounts: {
      leads: dash.stats.activeLeads || null,
      inbox: dash.stats.totalConversations || null,
      appointments: todaysJobs.length || null,
    },
    aiOn: dash.aiEmployees.some((e) => (e as { is_active?: boolean }).is_active !== false),
    rightNow,
    needsYou,
    monthLabel: impact.monthLabel,
    monthStats,
    tiles: [
      { label: 'Leads', value: dash.stats.activeLeads || null, sub: `${dash.stats.leads} total` },
      { label: 'Inbox', value: dash.stats.totalConversations || null, sub: 'last 7 days' },
      { label: 'Appointments', value: todaysJobs.length || null, sub: 'today' },
      { label: 'Calls', value: dash.stats.totalCalls || null, sub: 'last 7 days' },
    ],
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
