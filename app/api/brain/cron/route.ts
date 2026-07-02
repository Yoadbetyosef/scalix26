import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { runBrain } from '@/lib/brain/engine'
import { snapshotBrain, recordBrainUpdates } from '@/lib/brain/updates'

export const maxDuration = 300

// Nightly Business Brain study for every tenant's active AI employee. Fully DETERMINISTIC
// (no LLM, ~free), so it can run every night — that's what makes "I studied your business
// overnight" literally true. Records what changed into brain_updates. Per-tenant isolated.
async function handle(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const cronOk = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
  const vercelCron = !!req.headers.get('x-vercel-cron')
  const devOk = process.env.NODE_ENV !== 'production'
  if (!cronOk && !vercelCron && !devOk) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: tenants } = await admin.from('tenants').select('id').order('created_at', { ascending: false }).limit(300)

  let studied = 0, changed = 0
  for (const t of tenants || []) {
    try {
      const { data: agents } = await admin.from('ai_employees').select('id, status').eq('tenant_id', t.id).order('created_at', { ascending: true })
      const agentId = (agents || []).find((a) => a.status === 'active')?.id || (agents || [])[0]?.id
      if (!agentId) continue
      const before = await snapshotBrain(admin, t.id, agentId)
      await runBrain(admin, t.id, agentId)
      const after = await snapshotBrain(admin, t.id, agentId)
      changed += await recordBrainUpdates(admin, t.id, agentId, before, after)
      studied++
    } catch { /* skip this tenant, keep going */ }
  }
  return NextResponse.json({ ok: true, studied, changed })
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
