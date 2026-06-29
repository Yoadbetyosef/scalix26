import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { runLearning } from '@/lib/learning/engine'
import { formatReport } from '@/lib/learning/report'

// Background learning pass. Cron-triggered for all tenants; supports a per-tenant dry run
// for review (no writes). This route NEVER changes customer-facing behavior — it only
// observes and writes to the learning tables.
export const maxDuration = 300

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === '1' || url.searchParams.get('dry') === 'true'
  const tenantId = url.searchParams.get('tenantId') || undefined

  // Auth: Vercel cron, an explicit CRON_SECRET bearer, or local dev (for the review run).
  const auth = req.headers.get('authorization') || ''
  const cronOk = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
  const vercelCron = !!req.headers.get('x-vercel-cron')
  const devOk = process.env.NODE_ENV !== 'production'
  if (!cronOk && !vercelCron && !devOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Single-tenant dry run → return the full report + formatted text (the review path).
  if (tenantId && dry) {
    const report = await runLearning({ admin, tenantId, persist: false })
    return NextResponse.json({ report, text: formatReport(report) })
  }

  // Otherwise run (persist) across tenants.
  let tenantIds: string[]
  if (tenantId) tenantIds = [tenantId]
  else {
    const { data } = await admin.from('tenants').select('id').order('created_at', { ascending: false }).limit(100)
    tenantIds = (data || []).map((t) => t.id)
  }

  const summaries: Record<string, unknown>[] = []
  for (const tid of tenantIds.slice(0, 50)) {
    try {
      const r = await runLearning({ admin, tenantId: tid, persist: !dry })
      summaries.push({ tenant: tid, signals: r.counts.signals, hypotheses: r.hypotheses.length, suggestions: r.suggestions.length, persisted: r.persisted, notes: r.notes })
    } catch (e) {
      summaries.push({ tenant: tid, error: e instanceof Error ? e.message : 'failed' })
    }
  }
  return NextResponse.json({ tenants: summaries.length, summaries })
}

export async function GET(req: NextRequest) { return handle(req) } // Vercel cron uses GET
export async function POST(req: NextRequest) { return handle(req) }
