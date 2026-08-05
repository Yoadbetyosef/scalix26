// One sync, start to finish: claim a source, stream its products, work out what actually changed,
// write the difference, and leave the source in a state the UI can explain.
//
// THE DIFF RULES, which are the whole point of this file:
//   not found            → insert, first_seen_at = now
//   found, is_locked     → last_seen_at only. A tenant's edit is never overwritten by a sync.
//   found, hash equal    → last_seen_at only. No write to any other column.
//   found, hash changed  → update every field, bump updated_at
//
// And afterwards, ONLY if the run finished cleanly: everything this source didn't see this time is
// marked inactive. Never deleted. A run that failed or stopped halfway skips that step entirely —
// otherwise one bad afternoon on someone's hosting silently empties their catalogue.
import { adapterFor } from '../lib/ingestion/sources'
import { normalize } from '../lib/ingestion/normalizer'
import { newTelemetry, IngestionError, type ExtractionPattern, type SourceRef, type SourceType, type Telemetry } from '../lib/ingestion/types'
import { detectPlatform } from '../lib/ingestion/detector'
import { makeExtractor } from './llm'
import { db, finishJob, loadSource, rollErrorLog, updateSource, type SyncJobRow } from './db'

const BATCH = 100
const PROGRESS_EVERY = 25

interface ExistingRow {
  id: string; external_id: string | null; content_hash: string; is_locked: boolean
  first_seen_at: string; is_active: boolean
}

export interface RunStats {
  seen: number; inserted: number; updated: number; unchanged: number; locked: number
  skipped: number; deactivated: number
  uaFallbacks: number; pagesFetched: number; llmCalls: number; llmCostUsd: number
}

export async function runJob(job: SyncJobRow, signal: AbortSignal): Promise<void> {
  const runStartedAt = new Date().toISOString()
  const telemetry = newTelemetry()
  const stats: RunStats = {
    seen: 0, inserted: 0, updated: 0, unchanged: 0, locked: 0, skipped: 0, deactivated: 0,
    uaFallbacks: 0, pagesFetched: 0, llmCalls: 0, llmCostUsd: 0,
  }

  const source = await loadSource(job.source_id)
  if (!source) {
    await finishJob(job.id, { status: 'failed', error: 'The source no longer exists.', finished_at: new Date().toISOString() })
    return
  }

  try {
    await updateSource(source.id, { status: 'syncing', progress: { current: 0, total: null, phase: 'starting' } })

    // A source can arrive here still undetected — the API route hands detection over whenever its
    // 12-second budget runs out. Detecting here costs the tenant nothing but a little more waiting.
    //
    // The test is "do we know how to read this yet", NOT "is it new". An uploaded file arrives
    // pending too, and its source_url is a filename — sending that through website detection returns
    // 'unreachable', fails the first attempt, and makes every spreadsheet upload look broken for a
    // minute before the retry succeeds.
    let sourceType = source.source_type as SourceType
    let pattern = (source.extraction_pattern ?? null) as ExtractionPattern | null

    if (sourceType === 'manual' || source.status === 'detecting') {
      await updateSource(source.id, { status: 'detecting', progress: { current: 0, total: null, phase: 'looking at the site' } })
      const detected = await detectPlatform(source.source_url, { budgetMs: 60_000, telemetry, signal })
      if (!detected.sourceType) throw new IngestionError(detected.reason ?? 'no_products_found', reasonMessage(detected.reason))
      sourceType = detected.sourceType
      pattern = detected.pattern ?? null
      await updateSource(source.id, {
        source_type: sourceType, detected_platform: detected.platform, extraction_pattern: pattern, status: 'syncing',
      })
    }

    const ref: SourceRef = {
      id: source.id, tenantId: source.tenant_id, sourceUrl: source.source_url, sourceType, extractionPattern: pattern,
    }

    let lastProgressAt = 0
    let discoveredPattern: ExtractionPattern | null = null
    const buffer: ReturnType<typeof normalize>[] = []

    const adapter = adapterFor(sourceType)
    for await (const raw of adapter(ref, {
      signal,
      telemetry,
      llm: makeExtractor(source.tenant_id, telemetry),
      onPattern: (p) => { discoveredPattern = p },
      onProgress: async (p) => {
        // Throttled: the UI reads this column, it does not need every product.
        if (p.current - lastProgressAt < PROGRESS_EVERY && p.current !== 0) return
        lastProgressAt = p.current
        await updateSource(source.id, { progress: { current: p.current, total: p.total, phase: p.phase } })
      },
    })) {
      if (signal.aborted) throw new Error('worker shutting down')
      stats.seen++
      const normalized = normalize(raw, source.source_url)
      if (!normalized) { stats.skipped++; continue }
      buffer.push(normalized)
      if (buffer.length >= BATCH) { await flush(source.tenant_id, source.id, sourceType, buffer.splice(0), stats) }
    }
    if (buffer.length) await flush(source.tenant_id, source.id, sourceType, buffer.splice(0), stats)

    // Nothing came back at all. Treated as a failure rather than "the shop has no products", because
    // the next step — deactivating everything not seen — would otherwise wipe the catalogue.
    if (stats.seen === 0) throw new IngestionError('no_products_found', 'The sync read the site but found no products.')

    // The run completed. Only now is it safe to conclude that an absent product is a gone product.
    const { data: staled } = await db
      .from('catalog_ingested_products')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('source_id', source.id)
      .eq('is_active', true)
      .lt('last_seen_at', runStartedAt)
      .select('id')
    stats.deactivated = staled?.length ?? 0

    carryTelemetry(stats, telemetry)

    const { count } = await db
      .from('catalog_ingested_products')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', source.id).eq('is_active', true)

    await updateSource(source.id, {
      status: 'active',
      last_synced_at: new Date().toISOString(),
      last_status: 'ok',
      products_found: count ?? stats.inserted + stats.updated + stats.unchanged,
      progress: null,
      ...(discoveredPattern ? { extraction_pattern: discoveredPattern } : {}),
    })
    await finishJob(job.id, { status: 'succeeded', finished_at: new Date().toISOString(), error: null, stats })

    console.log(`[catalog-worker] ${source.source_url} ok — +${stats.inserted} ~${stats.updated} =${stats.unchanged} 🔒${stats.locked} ✗${stats.deactivated}`)
  } catch (e) {
    carryTelemetry(stats, telemetry)
    await handleFailure(job, source.id, source.error_log, e, stats, telemetry)
  }
}

function carryTelemetry(stats: RunStats, t: Telemetry): void {
  stats.uaFallbacks = t.uaFallbacks
  stats.pagesFetched = t.pagesFetched
  stats.llmCalls = t.llmCalls
  stats.llmCostUsd = Number(t.llmCostUsd.toFixed(6))
}

// One batch of up to 100 products: read what we already have, sort each into one of four buckets,
// then make at most three requests to apply them.
async function flush(
  tenantId: string, sourceId: string, sourceType: SourceType,
  products: Array<ReturnType<typeof normalize>>, stats: RunStats,
): Promise<void> {
  const rows = products.filter((p): p is NonNullable<typeof p> => p !== null)
  if (!rows.length) return

  const ids = rows.map((r) => r.externalId)
  const { data: existingRows } = await db
    .from('catalog_ingested_products')
    .select('id, external_id, content_hash, is_locked, first_seen_at, is_active')
    .eq('source_id', sourceId)
    .in('external_id', ids)
  const existing = new Map<string, ExistingRow>(((existingRows as ExistingRow[]) ?? []).map((r) => [r.external_id ?? '', r]))

  const now = new Date().toISOString()
  const touchOnly: string[] = []          // locked, or unchanged: last_seen_at and nothing else
  const upserts: Record<string, unknown>[] = []

  for (const p of rows) {
    const hit = existing.get(p.externalId)

    if (hit?.is_locked) { touchOnly.push(hit.id); stats.locked++; continue }
    if (hit && hit.content_hash === p.contentHash && hit.is_active) { touchOnly.push(hit.id); stats.unchanged++; continue }

    upserts.push({
      ...(hit ? { id: hit.id } : {}),
      tenant_id: tenantId,
      source_id: sourceId,
      source_type: sourceType,
      external_id: p.externalId,
      title: p.title,
      description: p.description,
      price: p.price,
      compare_price: p.comparePrice,
      currency: p.currency,
      sku: p.sku,
      image_url: p.imageUrl,
      product_url: p.productUrl,
      availability: p.availability,
      raw_payload: p.rawPayload,
      content_hash: p.contentHash,
      is_active: true,
      // Preserved across updates: when we FIRST saw this product is a fact about the catalogue, not
      // about this run.
      first_seen_at: hit?.first_seen_at ?? now,
      last_seen_at: now,
      updated_at: now,
    })
    if (hit) stats.updated++; else stats.inserted++
  }

  if (touchOnly.length) {
    const { error } = await db.from('catalog_ingested_products').update({ last_seen_at: now }).in('id', touchOnly)
    if (error) throw new Error(`last_seen update failed: ${error.message}`)
  }
  if (upserts.length) {
    // Conflict target is the (tenant_id, source_id, external_id) unique index — a plain index, not a
    // partial one, so PostgREST can infer it.
    const { error } = await db.from('catalog_ingested_products')
      .upsert(upserts, { onConflict: 'tenant_id,source_id,external_id' })
    if (error) throw new Error(`upsert failed: ${error.message}`)
  }
}

// Retry three times with a widening gap, then stop and tell the tenant something they can act on.
async function handleFailure(
  job: SyncJobRow, sourceId: string, errorLog: unknown[] | null,
  e: unknown, stats: RunStats, telemetry: Telemetry,
): Promise<void> {
  const ingestion = e instanceof IngestionError ? e : null
  const reason = ingestion?.reason ?? 'fetch_failed'
  const message = ingestion ? ingestion.message : (e as Error).message || 'The sync failed.'
  const entry = {
    at: new Date().toISOString(), reason, message,
    attempt: job.attempts, robotsBlocked: telemetry.robotsBlocked.slice(0, 3),
  }

  // A site that says no does not say yes on the third ask. Retrying robots or an SPA wastes the
  // tenant's time and ours; those go straight to a state the UI can act on.
  // Retrying will not change any of these: a site that says no, a page with nothing on the server,
  // or a site that simply isn't a shop. They go straight to a state the tenant can act on.
  const terminal = reason === 'robots_blocked' || reason === 'spa_unsupported' || reason === 'low_confidence'
  const canRetry = !terminal && job.attempts < job.max_attempts

  if (canRetry) {
    const backoffMs = Math.min(60 * 60_000, 60_000 * 2 ** (job.attempts - 1)) * (0.5 + Math.random())
    await finishJob(job.id, {
      status: 'queued',
      run_after: new Date(Date.now() + backoffMs).toISOString(),
      error: message,
      stats,
    })
    await updateSource(sourceId, { status: 'syncing', last_status: reason, error_log: rollErrorLog(errorLog, entry) })
    console.warn(`[catalog-worker] job ${job.id} attempt ${job.attempts} failed (${reason}); retrying in ${Math.round(backoffMs / 1000)}s`)
    return
  }

  await finishJob(job.id, { status: 'failed', finished_at: new Date().toISOString(), error: message, stats })
  await updateSource(sourceId, {
    status: 'failed', last_status: reason, progress: null, error_log: rollErrorLog(errorLog, entry),
  })
  console.error(`[catalog-worker] job ${job.id} failed permanently (${reason}): ${message}`)
}

// The tenant-facing sentence for a detection failure. Kept here rather than in the UI so the reason
// and its explanation can't drift apart.
function reasonMessage(reason: string | undefined): string {
  switch (reason) {
    case 'spa_unsupported': return 'This site builds its pages in the browser, so there is nothing for us to read on the server.'
    case 'robots_blocked': return 'This site\'s robots.txt tells automated readers to stay out of the product pages.'
    case 'unreachable': return 'The site did not respond.'
    case 'no_products_found': return 'We reached the site but could not find anything that looks like a product.'
    case 'low_confidence': return 'We read a few pages of this site and they did not look like product pages.'
    default: return 'We could not read this site automatically.'
  }
}
