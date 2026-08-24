import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { getAttention } from '@/lib/dashboard/impact'
import { createAdminClient } from '@/lib/supabase/server'
import { loadArrivals, waitingCount } from '@/lib/inbox/arrivals'

// The single source of truth for "unresolved notifications", fetched by the client attention store
// (used by the notification bell on every page + as a live refresh for the dashboard). Returns the
// raw active attention items; the client reconciles them against dismiss/resolve state.
//
// It also returns `waiting` — the inbox's own two groups, drafts + unanswered. That is a
// DIFFERENT number from items.length and the hero's caption needs this one: the caption and the
// Needs You card were reading the two different quantities and contradicting each other on the
// same screen, "2 things need you" above "Nothing needs you". Both now read this.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ items: [], waiting: 0 }, { status: 401 })

  // Resolve the active workspace (owner tenant, or the client tenant a WL partner is operating) so the
  // bell reflects the tenant the operator is inside, not the partner's own. getAttention uses the admin client.
  const tenantId = await getActiveTenantId()
  if (!tenantId) return NextResponse.json({ items: [], waiting: 0 })

  const [items, tenantRow] = await Promise.all([
    getAttention(tenantId),
    createAdminClient().from('ai_employees').select('timezone').eq('tenant_id', tenantId).limit(1).maybeSingle(),
  ])
  const arrivals = await loadArrivals(tenantId, (tenantRow.data as { timezone?: string | null } | null)?.timezone ?? null)
  return NextResponse.json({ items, waiting: waitingCount(arrivals) })
}
