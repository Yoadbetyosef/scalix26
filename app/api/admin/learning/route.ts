import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { estimateImport } from '@/lib/learning/estimator'
import { LEARNING } from '@/lib/learning/config'

// Cost Simulator — ADMIN ONLY. Shows what every customer's learning costs us: per-job
// metrics (scanned/skipped/deduped/samples, calls, estimated vs actual tokens & cost,
// duration) and a lifetime cost rollup per tenant. Customers never see this.
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient()
  const url = new URL(req.url)

  // Optional live pre-flight estimate for a tenant (what an import WOULD cost).
  const estimateFor = url.searchParams.get('estimate')
  if (estimateFor) {
    const { data: ag } = await admin.from('ai_employees').select('id').eq('tenant_id', estimateFor).limit(1).maybeSingle()
    const estimate = await estimateImport(admin, estimateFor, ag?.id ?? null)
    return NextResponse.json({ estimate })
  }

  let jobs: Record<string, unknown>[] = []
  try {
    const { data } = await admin
      .from('learning_jobs')
      .select('id, tenant_id, source, phase, status, max_cost, records_scanned, records_skipped, records_deduplicated, samples_selected, patterns_known, patterns_similar, patterns_novel, patterns_deferred, cost_saved, llm_calls, estimated_tokens, actual_tokens, estimated_cost, actual_cost, estimated_duration_ms, duration_ms, hard_stopped_reason, optimization_notes, created_at, finished_at')
      .order('created_at', { ascending: false })
      .limit(500)
    jobs = data || []
  } catch {
    return NextResponse.json({ error: 'learning_jobs not migrated', limits: capSummary() }, { status: 200 })
  }

  // Attach business names + per-tenant lifetime rollups.
  const tenantIds = [...new Set(jobs.map((j) => String(j.tenant_id)))]
  const nameMap: Record<string, string> = {}
  if (tenantIds.length) {
    const { data: tens } = await admin.from('tenants').select('id, business_name').in('id', tenantIds)
    for (const t of tens || []) nameMap[t.id as string] = (t.business_name as string) || '—'
  }

  const rollup: Record<string, { tenant_id: string; business_name: string; jobs: number; lifetime_cost: number; lifetime_saved: number; llm_calls: number; last_run: string | null }> = {}
  for (const j of jobs) {
    const id = String(j.tenant_id)
    const r = rollup[id] || (rollup[id] = { tenant_id: id, business_name: nameMap[id] || '—', jobs: 0, lifetime_cost: 0, lifetime_saved: 0, llm_calls: 0, last_run: null })
    r.jobs += 1
    r.lifetime_cost += Number(j.actual_cost) || 0
    r.lifetime_saved += Number(j.cost_saved) || 0
    r.llm_calls += Number(j.llm_calls) || 0
    if (!r.last_run || String(j.created_at) > r.last_run) r.last_run = String(j.created_at)
  }
  const tenants = Object.values(rollup)
    .map((r) => ({ ...r, lifetime_cost: Number(r.lifetime_cost.toFixed(4)), lifetime_saved: Number(r.lifetime_saved.toFixed(4)) }))
    .sort((a, b) => b.lifetime_cost - a.lifetime_cost)

  const jobsOut = jobs.map((j) => ({ ...j, business_name: nameMap[String(j.tenant_id)] || '—' }))
  return NextResponse.json({ limits: capSummary(), tenants, jobs: jobsOut })
}

function capSummary() {
  return {
    initialCapUSD: LEARNING.MAX_COST.initial,
    incrementalCapUSD: LEARNING.MAX_COST.incremental,
    cronEnabled: LEARNING.CRON_ENABLED,
    enabled: LEARNING.ENABLED,
    historyMonths: LEARNING.HISTORY_MONTHS,
  }
}
