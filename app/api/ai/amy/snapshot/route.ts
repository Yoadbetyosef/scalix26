import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { buildSnapshot } from '@/lib/amy/registry'
import { getBusinessSnapshot } from '@/lib/amy/snapshot'
import { enforce } from '@/lib/ratelimit'

// A broad, tenant-scoped business snapshot for grounding the realtime voice agent (which can't call
// tools mid-conversation). Tenant = the validated ACTIVE workspace (owner tenant, or the operated
// client tenant) — never user_id — so the voice agent is grounded in the business being operated.
export async function GET() {
  const bctx = await requireActiveBusinessContext()
  if (!bctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const limited = await enforce('ai_amy', `tenant:${bctx.tenantId}`)
  if (limited) return limited

  const admin = createAdminClient()
  const { data: tenant } = await admin
    .from('tenants').select('id').eq('id', bctx.tenantId).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'no_tenant' }, { status: 404 })

  // Live business state (Layer 2) up top, then the detailed recent context for voice.
  const ctx = { tenantId: tenant.id, db: admin }
  const [live, detail] = await Promise.all([getBusinessSnapshot(ctx), buildSnapshot(ctx)])
  return NextResponse.json({ snapshot: `${live.text}\n\n${detail}` })
}
