import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { LeadsTable } from '@/components/dashboard/leads-table'
import { AppointmentsTable } from '@/components/dashboard/appointments-table'
import { ImpactDashboard } from '@/components/dashboard/impact-dashboard'
import { DashboardHero } from '@/components/dashboard/hero/dashboard-hero'
import { getImpactData } from '@/lib/dashboard/impact'
import { AttentionSync } from '@/components/dashboard/attention'
import { enabledModulesOf, effectiveModules } from '@/lib/modules'
import { getModuleFlags } from '@/lib/admin/module-flags'
import { getDashboardData } from '@/lib/dashboard/overview'
import { buildHeroInputs } from '@/lib/dashboard/briefing'

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const activeTab = tab === 'leads' ? 'leads' : tab === 'appointments' ? 'appointments' : 'overview'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Active workspace = the owner's tenant, or the client tenant a White Label partner switched into.
  const serviceSupabase = createAdminClient()
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/setup')
  const { data: tenant } = await serviceSupabase.from('tenants').select('*').eq('id', tenantId).maybeSingle()
  if (!tenant) redirect('/setup')

  // Module gating: the Leads tab needs `pipeline`, Appointments needs `scheduling`. Direct
  // access to a disabled tab (e.g. ?tab=leads) falls back to Overview.
  const moduleFlags = await getModuleFlags()
  const isEnterprise = Array.isArray((tenant as { tags?: string[] }).tags) && (tenant as { tags?: string[] }).tags!.includes('Enterprise')
  const modules = effectiveModules(enabledModulesOf(tenant), moduleFlags, isEnterprise)
  const pipelineOn = modules.includes('pipeline')
  const schedulingOn = modules.includes('scheduling')
  const effectiveTab =
    (activeTab === 'leads' && !pipelineOn) || (activeTab === 'appointments' && !schedulingOn) ? 'overview' : activeTab

  const { stats, aiEmployees, leads_list, leadLinks, appointments_list } = await getDashboardData(tenant.id)
  // Impact Dashboard (overview body) — computed only for the overview tab.
  const impactData = effectiveTab === 'overview' ? await getImpactData(tenant.id) : null

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

  if (effectiveTab === 'overview' && impactData) {
    // Moved to lib/dashboard/briefing.ts so /v2 can obtain the SAME briefing. Same inputs, same
    // values — see that file's header.
    const { employeeName, brainAgentId: agentId, briefing, presenceState, stateSentence, idleSentence, figures } =
      buildHeroInputs(aiEmployees, impactData, appointments_list, leads_list, stats)
    brainAgentId = agentId

    topSection = (
      <>
      <DashboardHero
        employeeName={employeeName}
        briefing={briefing}
        presenceState={presenceState}
        stateSentence={stateSentence}
        idleSentence={idleSentence}
        businessName={tenant.business_name || ''}
        tenantId={tenant.id}
        figures={figures}
      />
      </>
    )
  }

  // max-md bottom padding clears the pinned Talk-to-Rudi bar (~92px) which sits above the
  // fixed tab nav — on top of <main>'s pb-[72px] and the device safe-area inset.
  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-md:pb-[calc(100px_+_env(safe-area-inset-bottom))]">
      {/* Seed the single attention source with fresh server data (overview only). */}
      {impactData && <AttentionSync tenantId={tenant.id} items={impactData.attention} />}
      {topSection}


      {/* Tabs — Leads/Appointments only appear when their module is enabled. */}
      <div className="flex gap-1 border-b border-hairline">
        <Link
          href="/dashboard"
          className={`tap-target inline-block px-4 py-2.5 text-sm font-medium border-b-2 -mb-px rounded-t-lg transition-all [-webkit-tap-highlight-color:transparent] max-md:active:scale-[0.96] max-md:active:bg-accent/10 max-md:active:text-accent-strong ${effectiveTab === 'overview' ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
        >
          Overview
        </Link>
        {pipelineOn && (
          <Link
            href="/dashboard?tab=leads"
            className={`tap-target max-md:hidden md:inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px rounded-t-lg transition-all [-webkit-tap-highlight-color:transparent] max-md:active:scale-[0.96] max-md:active:bg-accent/10 max-md:active:text-accent-strong ${effectiveTab === 'leads' ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            Leads
            {stats.activeLeads > 0 && (
              <span className="bg-ink text-white text-xs font-semibold rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                {stats.activeLeads}
              </span>
            )}
          </Link>
        )}
        {schedulingOn && (
          <Link
            href="/dashboard?tab=appointments"
            className={`tap-target inline-block px-4 py-2.5 text-sm font-medium border-b-2 -mb-px rounded-t-lg transition-all [-webkit-tap-highlight-color:transparent] max-md:active:scale-[0.96] max-md:active:bg-accent/10 max-md:active:text-accent-strong ${effectiveTab === 'appointments' ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            Appointments
          </Link>
        )}
      </div>

      {effectiveTab === 'leads' ? (
        <LeadsTable leads={leads_list} links={leadLinks} />
      ) : effectiveTab === 'appointments' ? (
        <AppointmentsTable appointments={appointments_list} />
      ) : (
        <ImpactDashboard data={impactData!} businessName={tenant.business_name} brainAgentId={brainAgentId} tenantId={tenant.id} />
      )}
    </div>
  )
}
