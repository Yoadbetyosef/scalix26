import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { getAttention } from '@/lib/dashboard/impact'

// The single source of truth for "unresolved notifications", fetched by the client attention store
// (used by the notification bell on every page + as a live refresh for the dashboard). Returns the
// raw active attention items; the client reconciles them against dismiss/resolve state.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ items: [] }, { status: 401 })

  // Resolve the active workspace (owner tenant, or the client tenant a WL partner is operating) so the
  // bell reflects the tenant the operator is inside, not the partner's own. getAttention uses the admin client.
  const tenantId = await getActiveTenantId()
  if (!tenantId) return NextResponse.json({ items: [] })

  const items = await getAttention(tenantId)
  return NextResponse.json({ items })
}
