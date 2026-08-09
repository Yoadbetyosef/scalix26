import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { getDashboardData } from '@/app/dashboard/page'
import { getImpactData } from '@/lib/dashboard/impact'
import { rudiLine } from './rudi-line'
import { HomeClient, type HomeData } from './home-client'

// The v2 home screen.
//
// READ-ONLY, and reuse-only. Every figure below comes from a function that already feeds the current
// dashboard — `getDashboardData` and `getImpactData` — called exactly as the dashboard calls them.
// No query is written here, nothing is re-windowed, and no number is invented.
//
// Where the design asks for a metric the system does not record, the element is OMITTED rather than
// rendered as a placeholder: a grid of em dashes reads as a broken screen and hides which figures are
// real. The full list of what is missing, and what each would need, is in the handover notes.

export const dynamic = 'force-dynamic'

export default async function V2Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/dashboard')

  const { data: tenant } = await createAdminClient()
    .from('tenants').select('business_name, phone_number').eq('id', tenantId).maybeSingle()

  const [dash, impact] = await Promise.all([
    getDashboardData(tenantId),
    getImpactData(tenantId),
  ])

  // ── Right now: today's appointments ───────────────────────────────────────────────────────────
  // Compared as date strings because slot_date is a plain date column, not a timestamp — converting
  // it through a Date would introduce a timezone the column does not have.
  const todayIso = new Date().toISOString().slice(0, 10)
  const todaysJobs = dash.appointments_list.filter(
    (a) => a.slot_date === todayIso && a.status !== 'cancelled',
  )

  const rightNow = todaysJobs.map((a) => ({
    title: a.customer_name || 'Appointment',
    detail: [a.slot_time, a.service_type].filter(Boolean).join(' · ') || 'Booked',
  }))

  // ── Needs you: unanswered leads + callers who asked for a person ──────────────────────────────
  const unansweredLeads = dash.stats.activeLeads
  const humanRequested = impact.humanTakeoverCount

  const needsYou: { title: string; detail: string; action: string }[] = []
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

  // ── This month ────────────────────────────────────────────────────────────────────────────────
  // getImpactData windows to the CURRENT MONTH. The panel is labelled to match rather than relabelled
  // to match the design's "This week" — a month figure under a week heading would be a wrong number
  // wearing the right word.
  //
  // Only figures that exist are pushed. The grid reflows around however many that is.
  const monthStats: { label: string; value: string }[] = []
  monthStats.push({ label: 'Conversations managed', value: String(impact.conversationsManaged.value) })
  monthStats.push({ label: 'Customers helped', value: String(impact.customersHelped.value) })
  if (impact.coveragePct.value !== null) {
    monthStats.push({ label: 'Answered', value: `${Math.round(impact.coveragePct.value)}%` })
  }
  monthStats.push({ label: 'After hours or handover', value: String(impact.opportunities.value) })

  // ── Rail counts ───────────────────────────────────────────────────────────────────────────────
  const railPrimary = [
    { label: 'Leads', count: dash.stats.activeLeads || null },
    { label: 'Inbox', count: dash.stats.totalConversations || null },
    { label: 'Appointments', count: todaysJobs.length || null },
    { label: 'Contacts' },
  ]

  const aiOn = dash.aiEmployees.some((e) => (e as { is_active?: boolean }).is_active !== false)

  const data: HomeData = {
    businessName: (tenant?.business_name as string) || 'Your business',
    phone: (tenant?.phone_number as string) || null,
    line: rudiLine({ jobsToday: todaysJobs.length, unansweredLeads, humanRequested }),
    // The reply function's whole input. Same figures the panels render, so a spoken answer and the
    // screen beside it can never disagree.
    facts: {
      jobsToday: todaysJobs.length,
      unansweredLeads,
      humanRequested,
      monthLabel: impact.monthLabel,
      conversationsManaged: impact.conversationsManaged.value,
      customersHelped: impact.customersHelped.value,
      answeredPct: impact.coveragePct.value,
    },
    rail: {
      primary: railPrimary,
      groups: [
        { id: 'g1', label: 'Rudi', items: [
          { label: 'AI Employees', badge: aiOn ? 'ON' : undefined },
          { label: 'Knowledge' },
          { label: 'Test AI' },
        ] },
        { id: 'g2', label: 'Business', items: [
          { label: 'Orders' },
          { label: 'Analytics' },
          { label: 'Reports' },
        ] },
        { id: 'g3', label: 'Account', items: [
          { label: 'Billing' },
          { label: 'Settings' },
          { label: 'Sign Out', out: true },
        ] },
      ],
    },
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
    // The dashboard's own conversation list, newest first — the only recent-activity source that
    // already exists.
    recent: dash.conversations.slice(0, 8).map((c) => {
      const conv = c as { updated_at?: string; channel?: string; contact?: { name?: string } | null }
      const when = conv.updated_at ? new Date(conv.updated_at) : null
      return {
        time: when ? when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '',
        text: `${conv.contact?.name || 'Someone'} · ${conv.channel || 'message'}`,
      }
    }),
  }

  return <HomeClient data={data} />
}
