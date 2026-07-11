import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { getDrilldownRows } from '@/lib/dashboard/drilldown'
import type { DrilldownMetric } from '@/lib/dashboard/impact'

const VALID: DrilldownMetric[] = ['customers_assisted', 'opportunities', 'conversations_managed', 'coverage', 'attention_takeover', 'attention_leads']

// READ-ONLY proof drill-down. Strictly tenant-scoped: the tenant is resolved from the
// authenticated user — never accepted from the client — so no cross-tenant reads.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const metric = req.nextUrl.searchParams.get('metric') as DrilldownMetric | null
  if (!metric || !VALID.includes(metric)) return NextResponse.json({ error: 'invalid metric' }, { status: 400 })

  const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') || '0', 10) || 0)
  const limit = Math.min(50, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '50', 10) || 50))

  // Active workspace (owner tenant, or the client tenant a WL partner is operating). Tenant is resolved
  // server-side and never accepted from the client; getDrilldownRows uses the admin client, tenant-scoped.
  const tenantId = await getActiveTenantId()
  if (!tenantId) return NextResponse.json({ error: 'no tenant' }, { status: 404 })

  try {
    const result = await getDrilldownRows(tenantId, metric, offset, limit)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[drilldown] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed to load records' }, { status: 500 })
  }
}
