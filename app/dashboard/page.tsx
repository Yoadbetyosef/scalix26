import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { LeadsTable } from '@/components/dashboard/leads-table'
import { AppointmentsTable, type Appointment } from '@/components/dashboard/appointments-table'
import { ImpactDashboard } from '@/components/dashboard/impact-dashboard'
import { DashboardHero } from '@/components/dashboard/hero/dashboard-hero'
import type { PresenceState } from '@/components/dashboard/hero/dashboard-hero'
import { getImpactData } from '@/lib/dashboard/impact'
import type { Lead } from '@/types'

async function getDashboardData(tenantId: string) {
  const supabase = await createClient()

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { count: totalCalls },
    { count: totalSMS },
    { count: totalConversations },
    { count: leads },
    { count: activeLeads },
    { data: conversations },
    { data: aiEmployees },
    { data: leadRecords },
  ] = await Promise.all([
    // Total Calls — voice activity is logged as message_handled with
    // data.channel='voice' (no code ever emitted 'call_handled').
    supabase.from('analytics_events').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('event_type', 'message_handled').eq('data->>channel', 'voice').gte('created_at', sevenDaysAgo),
    // Text Messages — SMS only (message_handled also covers voice/social).
    supabase.from('analytics_events').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('event_type', 'message_handled').eq('data->>channel', 'sms').gte('created_at', sevenDaysAgo),
    // Live Chat — Instagram + Facebook conversations only.
    supabase.from('conversations').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).in('channel', ['instagram', 'facebook']).gte('created_at', sevenDaysAgo),
    // Leads Generated — total count, straight from the leads table (lead_captured
    // analytics events were never emitted, so the old count was stuck at 0).
    supabase.from('leads').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
    // Active leads (need attention) — for the Leads tab badge. Excludes booked
    // and dismissed.
    supabase.from('leads').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).in('status', ['new', 'contacted']),
    supabase.from('conversations')
      .select('*, contact:contacts(name, phone)')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(10),
    supabase.from('ai_employees')
      .select('*, channels(*), skills(*)')
      .eq('tenant_id', tenantId),
    // Leads — resilient: if the table doesn't exist yet, data is null -> []
    supabase.from('leads')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const leadsList = (leadRecords as Lead[] | null) || []

  // Map each lead to a destination: its SMS conversation if one exists,
  // otherwise the contact profile. Lets the dashboard rows be clickable.
  const leadLinks: Record<string, string> = {}
  const contactIds = [...new Set(leadsList.map(l => l.contact_id).filter((c): c is string => !!c))]
  if (contactIds.length) {
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, contact_id, updated_at')
      .eq('tenant_id', tenantId)
      .in('contact_id', contactIds)
      .order('updated_at', { ascending: false })
    const latestByContact: Record<string, string> = {}
    for (const c of (convs || []) as { id: string; contact_id: string | null }[]) {
      if (c.contact_id && !latestByContact[c.contact_id]) latestByContact[c.contact_id] = c.id
    }
    for (const lead of leadsList) {
      // ?from=leads lets the destination's back button return to the Leads tab
      if (lead.contact_id && latestByContact[lead.contact_id]) {
        leadLinks[lead.id] = `/inbox/${latestByContact[lead.contact_id]}?from=leads`
      } else if (lead.contact_id) {
        leadLinks[lead.id] = `/contacts/${lead.contact_id}?from=leads`
      }
    }
  }

  const { data: appointments } = await supabase
    .from('appointments')
    .select('id, customer_name, customer_phone, customer_email, channel, slot_date, slot_time, service_type, status, skip_review, review_sent_at')
    .eq('tenant_id', tenantId)
    .order('slot_date', { ascending: false })
    .order('slot_time', { ascending: true })
    .limit(100)

  return {
    stats: {
      totalCalls: totalCalls || 0,
      textMessages: totalSMS || 0,
      totalConversations: totalConversations || 0,
      leads: leads || 0,
      activeLeads: activeLeads || 0,
    },
    conversations: conversations || [],
    aiEmployees: aiEmployees || [],
    leads_list: leadsList,
    leadLinks,
    appointments_list: (appointments || []) as Appointment[],
  }
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const activeTab = tab === 'leads' ? 'leads' : tab === 'appointments' ? 'appointments' : 'overview'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Use service client to bypass RLS for tenant lookup
  const serviceSupabase = await createServiceClient()
  const { data: tenant } = await serviceSupabase
    .from('tenants')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!tenant) redirect('/setup')

  const { stats, aiEmployees, leads_list, leadLinks, appointments_list } = await getDashboardData(tenant.id)
  // Impact Dashboard (overview body) — computed only for the overview tab.
  const impactData = activeTab === 'overview' ? await getImpactData(tenant.id) : null

  // ── Hero (overview only) — bound to real data already on the page ─────────────
  // The compact header is preserved verbatim for the Leads/Appointments tabs.
  let brainAgentId: string | undefined
  let topSection = (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-light tracking-tight text-ink">Dashboard</h1>
        <p className="text-muted text-sm mt-0.5 truncate">{tenant.business_name}</p>
      </div>
      <Link href="/ai-employees/new" className="flex-shrink-0">
        <Button className="gap-2 text-sm">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New AI Employee</span>
          <span className="sm:hidden">New</span>
        </Button>
      </Link>
    </div>
  )

  if (activeTab === 'overview' && impactData) {
    const employeesTyped = aiEmployees as { id?: string; name?: string | null; status?: string | null; voice?: string | null }[]
    const primaryEmployee = employeesTyped.find((e) => e.status === 'active') || employeesTyped[0]
    const employeeName = primaryEmployee?.name || 'Your AI'
    const employeeVoice = primaryEmployee?.voice ?? null
    brainAgentId = primaryEmployee?.id

    const handled = impactData.conversationsManaged.value
    const booked = appointments_list.filter((a) => a.status === 'confirmed' || a.status === 'completed').length
    const recovered = leads_list.filter((l) => Boolean((l as { responded_at?: string | null }).responded_at)).length
    const answered = impactData.coveragePct.value
    const attentionCount = impactData.attention.length

    const presenceState: PresenceState = attentionCount > 0 ? 'attention' : handled > 0 ? 'working' : 'ready'

    // The soul: the AI's spoken status (the name lives in the eyebrow, not here).
    const stateSentence =
      attentionCount > 0
        ? `${attentionCount} ${attentionCount === 1 ? 'thing needs' : 'things need'} your attention.`
        : handled > 0
          ? 'On duty — watching every channel. Nothing needs you.'
          : 'On duty, watching your channels. Nothing needs you yet.'

    // Amy's knowledge — built entirely from the real data already on this page.
    const todayStr = new Date().toLocaleDateString('en-CA')
    const appointmentsToday = appointments_list.filter((a) => a.slot_date === todayStr && a.status !== 'cancelled').length
    const briefing = {
      employeeName,
      employeeVoice,
      handled,
      booked,
      recovered,
      coverage: answered,
      channelLine: impactData.channelBreakdown.map((c) => `${c.count} ${c.label}`).join(', ') || undefined,
      attention: impactData.attention.map((a) => ({ label: a.label, href: a.href })),
      leadsAwaiting: stats.activeLeads,
      callsAnswered: stats.totalCalls,
      textsHandled: stats.textMessages,
      appointmentsToday,
    }

    topSection = (
      <>
      <DashboardHero
        employeeName={employeeName}
        employeeVoice={employeeVoice}
        briefing={briefing}
        presenceState={presenceState}
        stateSentence={stateSentence}
        businessName={tenant.business_name || ''}
        tenantId={tenant.id}
        figures={[
          { value: handled, label: 'Handled' },
          { value: booked, label: 'Booked' },
          { value: recovered, label: 'Recovered' },
          { value: answered, suffix: '%', label: 'Answered' },
        ]}
      />
      </>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      {topSection}


      {/* Tabs */}
      <div className="flex gap-1 border-b border-hairline">
        <Link
          href="/dashboard"
          className={`tap-target inline-block px-4 py-2.5 text-sm font-medium border-b-2 -mb-px rounded-t-lg transition-all [-webkit-tap-highlight-color:transparent] max-md:active:scale-[0.96] max-md:active:bg-accent/10 max-md:active:text-accent-strong ${activeTab === 'overview' ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
        >
          Overview
        </Link>
        <Link
          href="/dashboard?tab=leads"
          className={`tap-target max-md:hidden md:inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px rounded-t-lg transition-all [-webkit-tap-highlight-color:transparent] max-md:active:scale-[0.96] max-md:active:bg-accent/10 max-md:active:text-accent-strong ${activeTab === 'leads' ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
        >
          Leads
          {stats.activeLeads > 0 && (
            <span className="bg-ink text-white text-xs font-semibold rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
              {stats.activeLeads}
            </span>
          )}
        </Link>
        <Link
          href="/dashboard?tab=appointments"
          className={`tap-target inline-block px-4 py-2.5 text-sm font-medium border-b-2 -mb-px rounded-t-lg transition-all [-webkit-tap-highlight-color:transparent] max-md:active:scale-[0.96] max-md:active:bg-accent/10 max-md:active:text-accent-strong ${activeTab === 'appointments' ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
        >
          Appointments
        </Link>
      </div>

      {activeTab === 'leads' ? (
        <LeadsTable leads={leads_list} links={leadLinks} />
      ) : activeTab === 'appointments' ? (
        <AppointmentsTable appointments={appointments_list} />
      ) : (
        <ImpactDashboard data={impactData!} businessName={tenant.business_name} brainAgentId={brainAgentId} tenantId={tenant.id} />
      )}
    </div>
  )
}
