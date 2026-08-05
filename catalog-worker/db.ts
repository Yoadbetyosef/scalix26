// Every database call the worker makes. supabase-js with the service role, exactly like the app's
// admin client — there is no direct Postgres connection anywhere in this codebase and this service
// does not introduce one. That also means there is no pool to exhaust: the voice path cannot be
// starved by a crawl, which was the point of the connection cap in the first place.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import WebSocketImpl from 'ws'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('[catalog-worker] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(1)
}

// supabase-js doesn't export the transport type, so it is read back off createClient's own options.
type RealtimeTransport = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>['transport']

export const db: SupabaseClient = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  // This service never opens a realtime channel, but supabase-js builds its realtime client eagerly
  // and throws at construction on any runtime without a global WebSocket — which is every Node 20.
  // Handing it `ws` means the worker boots on Node 20 and 22 alike, rather than depending on which
  // base image it happens to land on.
  realtime: { transport: WebSocketImpl as unknown as RealtimeTransport },
})

export interface SyncJobRow {
  id: string
  tenant_id: string
  source_id: string
  trigger: string
  status: string
  attempts: number
  max_attempts: number
  started_at: string | null
}

export interface SourceRow {
  id: string
  tenant_id: string
  source_url: string
  source_type: string
  detected_platform: string | null
  status: string
  extraction_pattern: Record<string, unknown> | null
  error_log: unknown[] | null
  products_found: number
}

// The atomic claim. FOR UPDATE SKIP LOCKED lives in the database (claim_catalog_sync_jobs) because
// PostgREST cannot express it — two worker instances polling this function will never take the same
// job, so scaling out is a matter of starting another container.
export async function claimJobs(workerId: string, limit: number): Promise<SyncJobRow[]> {
  if (limit <= 0) return []
  const { data, error } = await db.rpc('claim_catalog_sync_jobs', { p_worker: workerId, p_limit: limit })
  if (error) { console.error('[catalog-worker] claim failed:', error.message); return [] }
  return (data as SyncJobRow[]) ?? []
}

export async function loadSource(sourceId: string): Promise<SourceRow | null> {
  const { data } = await db.from('catalog_sources').select('*').eq('id', sourceId).maybeSingle()
  return (data as SourceRow) ?? null
}

export async function updateSource(sourceId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('catalog_sources').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', sourceId)
  if (error) console.error(`[catalog-worker] source ${sourceId} update failed:`, error.message)
}

export async function finishJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('catalog_sync_jobs').update(patch).eq('id', jobId)
  if (error) console.error(`[catalog-worker] job ${jobId} update failed:`, error.message)
}

// A rolling five, newest first — enough to see a pattern, small enough that a site failing hourly
// can't grow the row without bound.
export function rollErrorLog(existing: unknown[] | null, entry: Record<string, unknown>): unknown[] {
  return [entry, ...((existing ?? []) as unknown[])].slice(0, 5)
}
