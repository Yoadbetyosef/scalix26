import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cronAuthorized } from '@/lib/cron/auth'

// Retention cleanup for processed_webhook_events (the idempotency/replay-guard table). Each row
// carries expires_at (default now() + 30 days); this job deletes rows past their expiry so the
// table stays small and the dedup unique index stays fast. Idempotent — safe to run repeatedly.
// Scheduled daily in vercel.json; gated by the shared fail-closed CRON_SECRET.
async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('processed_webhook_events')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .select('id')

  if (error) {
    console.error('[cron/webhook-events] cleanup failed:', error.message)
    return NextResponse.json({ ok: false, error: 'cleanup_failed' }, { status: 500 })
  }
  const deleted = data?.length ?? 0
  console.log(`[cron/webhook-events] deleted ${deleted} expired event(s)`)
  return NextResponse.json({ ok: true, deleted })
}

export async function GET(req: NextRequest) {
  return handle(req)
}
export async function POST(req: NextRequest) {
  return handle(req)
}
