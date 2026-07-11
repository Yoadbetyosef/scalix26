import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { runLearning } from '@/lib/learning/engine'
import { formatReport } from '@/lib/learning/report'
import { LEARNING } from '@/lib/learning/config'
import { cronAuthorized } from '@/lib/cron/auth'

// Background learning pass. Cron-triggered for all tenants; supports a per-tenant dry run
// for review (no writes). This route NEVER changes customer-facing behavior — it only
// observes and writes to the learning tables.
export const maxDuration = 300

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === '1' || url.searchParams.get('dry') === 'true'
  const tenantId = url.searchParams.get('tenantId') || undefined

  // Auth: shared fail-closed CRON_SECRET bearer (Vercel cron auto-attaches it); local dev bypass only.
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Single-tenant dry run → return the full report + formatted text (the review path).
  // Always allowed: it's a manual, budget-gated review that writes nothing.
  if (tenantId && dry) {
    const report = await runLearning({ admin, tenantId, persist: false })
    return NextResponse.json({ report, text: formatReport(report) })
  }

  // Cron kill-switch (point 12): scheduled / cross-tenant persisted runs stay OFF until
  // LEARNING_CRON_ENABLED=true is explicitly set. This is the fan-out that could cost the
  // most, so it cannot run by accident. A manual single-tenant persist is still allowed.
  const isCron = !!req.headers.get('x-vercel-cron') || (!tenantId)
  if (isCron && !LEARNING.CRON_ENABLED) {
    return NextResponse.json({ ok: true, ran: false, reason: 'learning_cron_disabled', message: 'Automatic learning cron is disabled until cost controls are approved (set LEARNING_CRON_ENABLED=true to enable).' })
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
