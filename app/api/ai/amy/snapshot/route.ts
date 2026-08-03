import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { buildSnapshot } from '@/lib/amy/registry'
import { getBusinessSnapshot } from '@/lib/amy/snapshot'
import { assembleBusinessContext } from '@/lib/brain/context/orchestrate'
import { currentDateContext } from '@/lib/appointments'
import { getBusinessTimezone } from '@/lib/timezone'
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

  // Grounding for the realtime voice agent (it can't call tools mid-conversation):
  //   • the REAL current date/time (so it never guesses a stale day),
  //   • the live Business Context (catalog/products/prices/stock + business hours/location) so it can
  //     actually READ the catalog and answer product questions,
  //   • the live business state (Layer 2) and detailed recent context.
  const ctx = { tenantId: tenant.id, db: admin }
  const [live, detail, tz, bizContext] = await Promise.all([
    getBusinessSnapshot(ctx),
    buildSnapshot(ctx),
    getBusinessTimezone(tenant.id),
    assembleBusinessContext(
      // audience:'owner' — this grounds the OWNER's own dashboard agent, not an inbound customer call.
      { tenantId: tenant.id, agentId: null, channel: 'voice', query: '', essentialsOnly: true, contactId: null, audience: 'owner' },
      // Force catalog AND orders in. The voice agent can't call tools mid-conversation, so whatever is
      // absent here it simply does not know — which is why it kept asking where the orders are kept.
      { include: ['catalog', 'orders'] },
    ).catch(() => ''),
  ])
  const snapshot = [currentDateContext(tz), live.text, bizContext, detail].filter(Boolean).join('\n\n')
  return NextResponse.json({ snapshot })
}
