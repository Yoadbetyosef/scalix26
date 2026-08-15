import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { getDashboardData } from '@/lib/dashboard/overview'
import { enabledModulesOf, effectiveModules } from '@/lib/modules'
import { getModuleFlags } from '@/lib/admin/module-flags'
import type { Lead, LeadSource } from '@/types'
import { ListPage, type ListFilter, type ListRow } from '../list'
// From channels.ts, not list.tsx: this is called on the SERVER, and a client module's exports are
// proxies there. See channels.ts.
import { channelKey } from '../channels'
import { leadsLine } from './line'

// Leads, reskinned. Same rows, same fields, same order, same source as the ?tab=leads view on
// /dashboard — getDashboardData is the one the dashboard itself calls, and it already returned both
// leads_list and leadLinks, so this page adds no query of its own.
//
// READ-ONLY. Every action renders, so the layout is honest about what the real screen offers, and
// every action is disabled with title="v2 preview".

export const dynamic = 'force-dynamic'

// Verbatim from components/dashboard/leads-table.tsx — the labels a lead's source shows today.
const SOURCE_LABELS: Record<LeadSource, string> = {
  missed_call: 'Missed Call',
  voice_call: 'Voice Call',
  web_form: 'Web Form',
  google_lsa: 'Google LSA',
  facebook: 'Facebook',
  yelp: 'Yelp',
  angi: 'Angi',
  other: 'Other',
}

// Also verbatim. Same thresholds, same wording.
function relativeTime(iso: string): string {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return 'Just now'
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`
  return `${Math.floor(sec / 86400)} d ago`
}

// All EXCLUDES dismissed, which is exactly what the table does today: dismissed rows are hidden until
// the "Show dismissed (N)" toggle is pressed. Same rule, a clearer control.
const FILTERS: ListFilter[] = [
  { id: 'all', label: 'All', buckets: ['new', 'contacted', 'booked'] },
  { id: 'new', label: 'New', buckets: ['new'] },
  { id: 'open', label: 'Open', buckets: ['contacted'] },
  { id: 'booked', label: 'Booked', buckets: ['booked'] },
  { id: 'dismissed', label: 'Dismissed', buckets: ['dismissed'] },
]

const PREVIEW = 'v2 preview'

export default async function V2Leads() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/dashboard')

  // The same gate /dashboard applies: without `pipeline` the Leads tab does not exist there, and
  // reaching ?tab=leads directly falls back to Overview. Here the equivalent fallback is /v2.
  const { data: tenant } = await createAdminClient().from('tenants').select('*').eq('id', tenantId).maybeSingle()
  if (!tenant) redirect('/dashboard')
  const isEnterprise = Array.isArray((tenant as { tags?: string[] }).tags) && (tenant as { tags?: string[] }).tags!.includes('Enterprise')
  const modules = effectiveModules(enabledModulesOf(tenant), await getModuleFlags(), isEnterprise)
  if (!modules.includes('pipeline')) redirect('/v2')

  const { leads_list, leadLinks } = await getDashboardData(tenantId)

  const rows: ListRow[] = (leads_list as Lead[]).map((l) => {
    const dismissed = l.status === 'dismissed'
    return {
      id: l.id,
      primary: l.name || 'Unknown',
      // Source and phone, the two things the current card shows under the name. The time moves to the
      // trailing slot, where the reference puts its figure.
      detail: [SOURCE_LABELS[l.source] || l.source, l.phone].filter(Boolean).join(' · '),
      trailing: relativeTime(l.created_at),
      trailingTone: l.status === 'new' ? 'positive' : null,
      marked: l.status === 'new',
      muted: dismissed,
      href: leadLinks[l.id] ?? null,
      bucket: l.status,
      channel: channelKey(l.source),
      // New and contacted are the two that have not been answered — the same pair stats.activeLeads counts.
      needsYou: l.status === 'new' || l.status === 'contacted',
      // The same actions the card offers today, under the same conditions — Call for a lead with a
      // phone, Dismiss until it is, Restore once it has been. "Mark as Booked" is gone from both:
      // booked is derived from a confirmed appointment now (lib/leads/booked.ts).
      actions: [
        ...(l.phone ? [{ label: 'Call', tone: 'primary' as const, disabledReason: PREVIEW }] : []),
        ...(!dismissed ? [{ label: 'Dismiss', disabledReason: PREVIEW }] : []),
        ...(dismissed ? [{ label: 'Restore', disabledReason: PREVIEW }] : []),
      ],
    }
  })

  const waiting = (leads_list as Lead[]).filter((l) => l.status === 'new' || l.status === 'contacted')
  // leads_list is ordered created_at DESC, so the oldest unanswered lead is the last of them.
  const oldest = waiting.length ? waiting[waiting.length - 1] : null

  const line = leadsLine({
    newCount: rows.filter((r) => r.bucket === 'new').length,
    openCount: rows.filter((r) => r.bucket === 'contacted').length,
    bookedCount: rows.filter((r) => r.bucket === 'booked').length,
    oldestWaiting: oldest ? { name: oldest.name || 'Someone', waited: relativeTime(oldest.created_at).replace(' ago', '') } : null,
  })

  return (
    <ListPage
      title="Leads"
      line={line}
      filters={FILTERS}
      initialFilter="all"
      rows={rows}
      backHref="/v2"
      empty={{
        title: 'No leads yet',
        body: 'When Rudi captures a lead from a call or a message, it lands here automatically.',
      }}
    />
  )
}

