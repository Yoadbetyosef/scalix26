import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { cronAuthorized } from '@/lib/cron/auth'

// Hourly. Enqueues the sources due this hour and does nothing else — no fetching, no parsing, no
// writing of products. A serverless function cannot crawl a website inside its timeout, and pretending
// otherwise is how this feature would fail in production.
//
// The staggering happens in the data: every source carries sync_hour = hash(tenant_id) % 24, so each
// tenant's catalogue refreshes at their own hour and the load spreads across the day instead of every
// site in the system being crawled at midnight.
async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const db = createAdminClient()
  const hour = new Date().getUTCHours()

  const { data: sources, error } = await db
    .from('catalog_sources')
    .select('id, tenant_id, sync_frequency, last_synced_at')
    .eq('status', 'active')
    .eq('sync_hour', hour)
    .is('deleted_at', null)
    .neq('sync_frequency', 'manual')
    .limit(1000)

  if (error) {
    console.error('[cron/catalog-sync] query failed:', error.message)
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 })
  }

  const now = Date.now()
  const due = (sources ?? []).filter((s) => {
    if (!s.last_synced_at) return true
    const age = now - new Date(s.last_synced_at as string).getTime()
    // A little under the nominal window, so an hour that runs slightly early doesn't skip a day.
    const window = s.sync_frequency === 'weekly' ? 7 * 24 * 3600_000 : 24 * 3600_000
    return age >= window - 3600_000
  })

  let queued = 0
  let skipped = 0
  for (const s of due) {
    // One live job per source. The index that enforces it is partial, so PostgREST can't use it as an
    // ON CONFLICT target — check, insert, and treat the lost race (23505) as "already queued".
    const { data: live } = await db.from('catalog_sync_jobs')
      .select('id').eq('source_id', s.id as string).in('status', ['queued', 'running']).maybeSingle()
    if (live) { skipped++; continue }

    const { error: insertError } = await db.from('catalog_sync_jobs').insert({
      tenant_id: s.tenant_id, source_id: s.id, trigger: 'cron', status: 'queued',
    })
    if (insertError && insertError.code !== '23505') {
      console.error(`[cron/catalog-sync] enqueue failed for ${s.id}:`, insertError.message)
      continue
    }
    if (insertError) skipped++
    else queued++
  }

  console.log(`[cron/catalog-sync] hour ${hour}: ${due.length} due, ${queued} queued, ${skipped} already running`)
  return NextResponse.json({ ok: true, hour, due: due.length, queued, skipped })
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
