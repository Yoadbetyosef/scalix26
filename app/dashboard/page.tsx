import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DashboardHero } from '@/components/dashboard/hero/dashboard-hero'
import { getImpactData } from '@/lib/dashboard/impact'
import { AttentionSync } from '@/components/dashboard/attention'
import { getDashboardData } from '@/lib/dashboard/overview'
import { buildHeroInputs } from '@/lib/dashboard/briefing'
import { buildHomeView } from '@/lib/dashboard/home-view'
import { loadArrivals, waitingCount } from '@/lib/inbox/arrivals'

// NO TABS, SO NO searchParams. `?tab=leads` and `?tab=appointments` are both dead links now — the
// first went with the Leads removal, the second when appointments got a page. Next serves
// /dashboard for either, which is the right answer for an old bookmark.
export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Active workspace = the owner's tenant, or the client tenant a White Label partner switched into.
  const serviceSupabase = createAdminClient()
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/setup')
  const { data: tenant } = await serviceSupabase.from('tenants').select('*').eq('id', tenantId).maybeSingle()
  if (!tenant) redirect('/setup')

  const { stats, aiEmployees, leads_list, appointments_list } = await getDashboardData(tenant.id)
  // Everything the hero and its right column need. The module gating that used to live here was
  // there for the tab strip; the rail does that job for every route now, and /appointments carries
  // its own `scheduling` check in its layout.
  const impactData = await getImpactData(tenant.id)

  // ── The hero, bound to data already on the page ───────────────────────────────
  // Seeded into the attention store, which the caption, the NEEDS YOU card, the bell and the voice
  // assistant all read.
  let heroWaiting = 0
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

  if (impactData) {
    // Moved to lib/dashboard/briefing.ts so /v2 can obtain the SAME briefing. Same inputs, same
    // values — see that file's header.
    // The inbox's own arrivals grouping. ONE query, and the only one this hero adds: it is what lets
    // the caption say "N new people today" — the clause /v2 has — and what Right Now / Needs You are
    // built from. Read after the two above because it needs the business timezone, which comes from
    // the employee rows they already loaded.
    const arrivals = await loadArrivals(
      tenant.id,
      (aiEmployees[0] as { timezone?: string | null } | undefined)?.timezone ?? null,
    )
    const view = buildHomeView(
      { stats, appointments_list },
      impactData,
      arrivals,
      waitingCount(arrivals),
    )
    heroWaiting = view.waiting

    const { employeeName, persona: primaryPersona, briefing, presenceState } =
      buildHeroInputs(aiEmployees, impactData, appointments_list, leads_list, stats)

    topSection = (
      <>
      <DashboardHero
        employeeName={employeeName}
        persona={primaryPersona}
        briefing={{ ...briefing, waitingOnYou: view.waiting }}
        view={view}
        presenceState={presenceState}
        tenantId={tenant.id}
      />
      </>
    )
  }

  // NOTHING SCROLLS UNDER THE HERO ANY MORE, ON ANY TENANT.
  //
  // The wrapper's max-md bottom padding went too. Its comment said it cleared "the pinned
  // Talk-to-Rudi bar (~92px) which sits above the fixed tab nav" — there is no pinned Talk bar and
  // no tab nav; both were gone before this change and the padding had outlived both.
  //
  // What was left below it was a tab strip — Overview | Appointments — and, under Overview, the
  // Attention Needed list. Both are gone from here. Appointments got a page of its own and a live
  // row in the rail (a tab is not navigation; the rail is). Attention Needed moved into the hero's
  // right column, into the NEEDS YOU card, which is where the same question was already being asked
  // and answered — wrongly, because the card said "nothing needs you" while the banner below it
  // listed nine things.
  //
  // AttentionSync stays: it is what seeds the store the column, the bell and the voice assistant
  // all read, and it renders nothing.
  return (
    <div>
      {impactData && <AttentionSync tenantId={tenant.id} items={impactData.attention} waiting={heroWaiting} />}
      {topSection}
    </div>
  )
}
