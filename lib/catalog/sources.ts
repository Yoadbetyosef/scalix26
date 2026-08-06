import { createAdminClient } from '@/lib/supabase/server'
import { normalizeSourceUrl } from '@/lib/ingestion/http'
import type { DetectionResult, SourceType } from '@/lib/ingestion/types'

// Server-side store for catalog sources. Every function here takes a server-validated tenantId from
// requireCatalogTenant — the same gate the rest of the catalog module uses — and goes through the
// admin client, because these tables have RLS on with no policy (see add_catalog_ingestion_1.sql).
//
// The worker owns everything after a job is queued. Nothing in this file fetches a website.

export interface CatalogSource {
  id: string
  source_url: string
  source_type: SourceType
  detected_platform: string | null
  status: 'pending' | 'detecting' | 'syncing' | 'active' | 'failed' | 'paused'
  sync_frequency: 'daily' | 'weekly' | 'manual'
  last_synced_at: string | null
  last_status: string | null
  products_found: number
  progress: { current: number; total: number | null; phase: string } | null
  error_log: Array<{ at: string; reason: string; message: string }> | null
  created_at: string
}

const SOURCE_COLUMNS = 'id, source_url, source_type, detected_platform, status, sync_frequency, last_synced_at, last_status, products_found, progress, error_log, created_at'

export async function listSources(tenantId: string): Promise<CatalogSource[]> {
  const { data } = await createAdminClient()
    .from('catalog_sources')
    .select(SOURCE_COLUMNS)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  return ((data as CatalogSource[]) ?? [])
}

export async function getSource(tenantId: string, id: string): Promise<CatalogSource | null> {
  const { data } = await createAdminClient()
    .from('catalog_sources').select(SOURCE_COLUMNS)
    .eq('tenant_id', tenantId).eq('id', id).is('deleted_at', null).maybeSingle()
  return (data as CatalogSource) ?? null
}

export interface CreateSourceInput {
  tenantId: string
  url: string
  detection: DetectionResult | null
  ownershipConfirmed: boolean
}

// Re-connecting a URL the tenant already has updates that source rather than creating a second one —
// the unique index on (tenant_id, source_url) says so, and silently failing on it would read as a
// bug to the person clicking the button.
export async function upsertSource(input: CreateSourceInput): Promise<{ source: CatalogSource | null; error?: string }> {
  const url = normalizeSourceUrl(input.url)
  if (!url) return { source: null, error: 'That does not look like a website address.' }

  const db = createAdminClient()
  const { data: hourRow } = await db.rpc('catalog_sync_hour', { p_tenant: input.tenantId })
  const syncHour = typeof hourRow === 'number' ? hourRow : 0

  const detection = input.detection
  const row = {
    tenant_id: input.tenantId,
    source_url: url,
    // No detected type means the worker will look again with a longer budget — the source is not
    // failed, it is simply not identified yet.
    source_type: detection?.sourceType ?? 'manual',
    detected_platform: detection?.platform ?? null,
    status: detection?.sourceType ? 'pending' : detection?.reason ? 'failed' : 'detecting',
    last_status: detection?.reason ?? null,
    sync_hour: syncHour,
    ownership_confirmed: input.ownershipConfirmed,
    extraction_pattern: detection?.pattern ?? null,
    updated_at: new Date().toISOString(),
  }

  // Deliberately NOT filtered on deleted_at. A disconnected source used to be invisible here, so
  // reconnecting the same site inserted a parallel row — and because products are keyed on
  // (tenant_id, source_id, external_id), the sync then wrote a second full copy of the catalogue and
  // orphaned the first. One 9,179-product store became 18,358 rows, half of them dead weight the
  // index still had to scan.
  //
  // Reviving the original row instead is also what makes deleteSource's promise true: the old
  // products are still attached to it, and the diff engine reactivates them in place.
  const { data: existing } = await db.from('catalog_sources')
    .select('id, deleted_at').eq('tenant_id', input.tenantId).eq('source_url', url).maybeSingle()

  const q = existing
    ? db.from('catalog_sources').update({ ...row, deleted_at: null }).eq('id', existing.id as string)
    : db.from('catalog_sources').insert(row)

  const { data, error } = await q.select(SOURCE_COLUMNS).single()
  if (error) return { source: null, error: error.message }
  return { source: data as CatalogSource }
}

// An uploaded file is a source like any other, not a one-off import: the file text and the column
// mapping are stored on the source so a re-sync replays the same file, and so the worker's diff
// engine — the only thing that writes products — stays the single writer.
//
// The pseudo-URL is what makes re-uploading the same file update that source instead of creating a
// second one, via the same unique index the website sources use.
export async function createCsvSource(
  tenantId: string, fileName: string, csvText: string, mapping: Array<string | null>,
): Promise<{ source: CatalogSource | null; error?: string }> {
  const db = createAdminClient()
  const sourceUrl = `file://${fileName.replace(/[^\w.-]+/g, '_').slice(0, 120)}`
  const { data: hourRow } = await db.rpc('catalog_sync_hour', { p_tenant: tenantId })

  const row = {
    tenant_id: tenantId,
    source_url: sourceUrl,
    source_type: 'csv_upload' as const,
    detected_platform: 'Uploaded file',
    status: 'pending' as const,
    // A file cannot go stale on its own, so nothing schedules it. It re-reads when the tenant says so.
    sync_frequency: 'manual' as const,
    sync_hour: typeof hourRow === 'number' ? hourRow : 0,
    ownership_confirmed: true,
    extraction_pattern: { tier: 'csv_upload', csvText, mapping, discoveredAt: new Date().toISOString() },
    last_status: null,
    updated_at: new Date().toISOString(),
  }

  // Same as above: re-uploading a file whose source was disconnected must revive that source rather
  // than start a second one beside it.
  const { data: existing } = await db.from('catalog_sources')
    .select('id').eq('tenant_id', tenantId).eq('source_url', sourceUrl).maybeSingle()

  const q = existing
    ? db.from('catalog_sources').update({ ...row, deleted_at: null }).eq('id', existing.id as string)
    : db.from('catalog_sources').insert(row)

  const { data, error } = await q.select(SOURCE_COLUMNS).single()
  if (error) return { source: null, error: error.message }
  return { source: data as CatalogSource }
}

// Queue a run. The unique index that allows only one live job per source is PARTIAL, which PostgREST
// cannot use as an ON CONFLICT target, so the duplicate is checked for here and a lost race is
// absorbed by treating 23505 as "already queued" — which is exactly what it means.
export async function enqueueSync(
  tenantId: string, sourceId: string, trigger: 'initial' | 'cron' | 'manual',
): Promise<{ queued: boolean; reason?: string }> {
  const db = createAdminClient()
  const { data: live } = await db.from('catalog_sync_jobs')
    .select('id').eq('source_id', sourceId).in('status', ['queued', 'running']).maybeSingle()
  if (live) return { queued: false, reason: 'already_running' }

  const { error } = await db.from('catalog_sync_jobs').insert({
    tenant_id: tenantId, source_id: sourceId, trigger, status: 'queued', run_after: new Date().toISOString(),
  })
  if (error) {
    if (error.code === '23505') return { queued: false, reason: 'already_running' }
    return { queued: false, reason: error.message }
  }
  return { queued: true }
}

// Soft-delete: the source stops syncing and its products stop counting, but nothing is destroyed.
// A tenant who disconnects a site by mistake gets everything back by reconnecting it.
export async function deleteSource(tenantId: string, id: string): Promise<{ ok: boolean; deactivated: number }> {
  const db = createAdminClient()
  const { data: source } = await db.from('catalog_sources')
    .select('id').eq('tenant_id', tenantId).eq('id', id).is('deleted_at', null).maybeSingle()
  if (!source) return { ok: false, deactivated: 0 }

  const now = new Date().toISOString()
  const { data: deactivated } = await db.from('catalog_ingested_products')
    .update({ is_active: false, updated_at: now })
    .eq('tenant_id', tenantId).eq('source_id', id).eq('is_active', true)
    .select('id')

  await db.from('catalog_sources').update({ deleted_at: now, status: 'paused', updated_at: now }).eq('id', id)
  // Any queued work for a source nobody wants is work nobody should do.
  await db.from('catalog_sync_jobs').update({ status: 'failed', error: 'Source disconnected.', finished_at: now })
    .eq('source_id', id).in('status', ['queued'])

  return { ok: true, deactivated: deactivated?.length ?? 0 }
}

export async function countProducts(tenantId: string, sourceId?: string): Promise<number> {
  let q = createAdminClient().from('catalog_ingested_products')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('is_active', true)
  if (sourceId) q = q.eq('source_id', sourceId)
  const { count } = await q
  return count ?? 0
}
