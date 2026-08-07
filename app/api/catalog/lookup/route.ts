import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { retrieveProducts, toToolPayload, RETRIEVAL_TIMEOUT_MS } from '@/lib/catalog/retrieval'
import { enabledModulesOf } from '@/lib/modules'

// The voice agent's product lookup. Called by voice-server when the model asks for a product mid-call,
// exactly like /api/appointments/available — the tenant is resolved from the lead token that the call
// already carries, because a phone call has no session.
//
// On the live-call path, so: no auth round trip, no session read, one retrieval, and a hard budget.
// A miss is a fine answer; a stall is not, because the caller hears silence either way and only the
// miss lets the agent move on.

export const maxDuration = 10

export async function GET(req: NextRequest) {
  const started = Date.now()
  const sp = req.nextUrl.searchParams
  const leadToken = sp.get('lead_token') || ''
  const query = (sp.get('q') || '').trim()

  if (!leadToken || !query) {
    return NextResponse.json({ found: false, say: "I didn't catch which product you meant — could you say it again?" })
  }

  const db = createAdminClient()
  // The lead token is the call's identity. Tenant resolved from it and used as the ONLY scope on
  // every read underneath — a caller can never reach another business's catalog.
  //
  // Timed because it is part of what the caller waits for and has never been inside `took_ms`. Two
  // reads happen out here, before retrieval starts, and until now they were invisible: the earlier
  // measurements showed took_ms=254 against total_ms=807, and none of that 550ms was attributed.
  const tTenant = Date.now()
  const { data: tenant } = await db
    .from('tenants').select('id, enabled_modules').eq('lead_intake_token', leadToken).maybeSingle()
  const tenantMs = Date.now() - tTenant

  if (!tenant) {
    return NextResponse.json({ found: false, say: "I can't look that up right now, but I can take a message." })
  }
  // Same gate as the rest of the catalog module: a business that hasn't turned it on has no catalog
  // to speak from, and the agent must not imply otherwise.
  if (!enabledModulesOf(tenant).includes('inventory')) {
    return NextResponse.json({ found: false, say: "I don't have a product list in front of me, but I can have someone call you back." })
  }

  // Can this agent actually transfer? Read, not assumed — a draft answer that offers to put the caller
  // through when no forward number is configured promises something the model has no tool to do
  // (voice-server only offers transfer_to_human when a number exists). One indexed read on a path that
  // already has a hard budget; a failure here just means the answer offers a callback instead.
  const tAgent = Date.now()
  const { data: agent } = await db
    .from('ai_employees').select('forward_to_phone').eq('tenant_id', tenant.id).maybeSingle()
  const agentMs = Date.now() - tAgent
  const canTransfer = Boolean(agent?.forward_to_phone)

  const result = await retrieveProducts(tenant.id as string, query, 'voice', {
    canTransfer,
    preStages: { tenant: tenantMs, agent: agentMs },
  })
  return NextResponse.json({
    ...JSON.parse(toToolPayload(result)),
    // Server-side timings: the only honest measurement of this path, since it excludes whatever
    // network sits between here and whoever is reading the number.
    took_ms: result.latencyMs,
    total_ms: Date.now() - started,
    // Echoed so a single curl shows the breakdown without a database round trip. The same object is
    // written to catalog_retrieval_log, where the percentiles live — one call cannot show variance.
    stages: { ...result.stages, response: Date.now() - started },
    timed_out: result.timedOut,
    budget_ms: RETRIEVAL_TIMEOUT_MS,
  })
}
