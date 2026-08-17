import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { enabledModulesOf } from '@/lib/modules'
import { planKeyterms } from '@/lib/catalog/terms'

// The words this tenant's callers will say that a general speech model has never heard.
//
// Fetched by voice-server once per call, before the Deepgram Settings message, and passed as
// `agent.listen.provider.keyterms`. It is the only repair for the constraint that turned out to bind
// everything else: a caller asked for a "RAJA sofa" and the tool received "Vaja soda", "Rosa raja",
// "Roger Solphine". Spelling it out loud — R-A-J-A — worked instantly. Nothing downstream was broken.
//
// Auth is the lead token, same as /api/catalog/lookup: a phone call has no session, and the token is
// the call's identity. Product NAMES only ever leave here — no prices, no costs, no stock.
//
// Off the live-call path in the sense that matters: it runs once at call setup, before the caller has
// said anything, so it is not competing with the retrieval budget.
export const maxDuration = 10

// A ceiling on rows read, not on terms kept — planKeyterms decides that. This exists so a tenant with
// 9,179 products cannot make call setup slow; the coverage rule will disable keyterms for them anyway.
const MAX_PRODUCTS = 5000
const PAGE = 1000

export async function GET(req: NextRequest) {
  const leadToken = req.nextUrl.searchParams.get('lead_token') || ''
  if (!leadToken) return NextResponse.json({ keyterms: [], state: 'disabled', reason: 'no token' })

  const db = createAdminClient()
  const { data: tenant } = await db
    .from('tenants').select('id, enabled_modules').eq('lead_intake_token', leadToken).maybeSingle()

  // No tenant, or no catalog module: nothing to boost, and the agent must not imply otherwise.
  if (!tenant || !enabledModulesOf(tenant).includes('inventory')) {
    return NextResponse.json({ keyterms: [], state: 'disabled', reason: 'no catalog' })
  }

  // Paged, because PostgREST caps a response at 1,000 rows regardless of `limit` — the trap that
  // already produced one wrong answer in this codebase.
  const names: string[] = []
  for (let from = 0; from < MAX_PRODUCTS; from += PAGE) {
    const { data } = await db.from('catalog_products')
      .select('name')
      // Drafts included: a product created from an invoice this morning is exactly the one a caller
      // is most likely to ask about, and its name is the least likely to be an English word.
      .eq('tenant_id', tenant.id).in('status', ['active', 'draft'])
      .order('id').range(from, from + PAGE - 1)
    const page = (data as Array<{ name: string }> | null) ?? []
    names.push(...page.map((p) => p.name))
    if (page.length < PAGE) break
  }

  const plan = planKeyterms(names)
  // Every field is returned, including on 'disabled'. A settings screen has to be able to say WHY
  // boosting is off for this business — "your catalogue is too varied to boost" is actionable, "off"
  // is not.
  return NextResponse.json(plan)
}
