import { createAdminClient } from '@/lib/supabase/server'
import { getDashboardData } from '@/lib/dashboard/overview'
import { getImpactData } from '@/lib/dashboard/impact'
import { loadArrivals, waitingCount } from '@/lib/inbox/arrivals'
import { buildHeroInputs } from '@/lib/dashboard/briefing'
import { buildHomeView } from '@/lib/dashboard/home-view'
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

  // The derivations moved to lib/dashboard/home-view.ts so /dashboard reads the same ones rather
  // than a second copy. Same values, same comments, one place.
  const view = buildHomeView(dash, impact, arrivals, waiting)

  return {
    line: rudiLine(view.line),
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
      appointments: view.line.jobsToday || null,
    },
    aiOn: dash.aiEmployees.some((e) => (e as { is_active?: boolean }).is_active !== false),
    rightNow: view.rightNow,
    needsYou: view.needsYou,
    monthLabel: view.monthLabel,
    monthStats: view.monthStats,
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
