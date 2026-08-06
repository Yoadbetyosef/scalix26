// Purge products left behind by a disconnected source.
//
// Products are never deleted by a sync — a run that fails halfway must not empty a catalogue, and a
// tenant who disconnects a site by mistake gets everything back by reconnecting it. That second
// promise is what kept the rows around.
//
// It stopped being true when reconnecting created a PARALLEL source instead of reviving the original
// (fixed in lib/catalog/sources.ts): the old products stayed attached to a source nobody would ever
// revive, while a second full copy of the catalogue was written beside them. The index still scanned
// both. On one 9,179-product store that meant 18,358 rows and a plan that threw half of them away.
//
// This clears what that already produced. Dry run by default.
//
//   node_modules/.bin/tsx scripts/cleanup-orphaned-catalog.ts [--days 30] [--commit]
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }

const args = process.argv.slice(2)
const commit = args.includes('--commit')
// A grace period, because "disconnected" is often "disconnected by accident". Zero means purge every
// orphan regardless of age — used when clearing a known duplicate set.
const days = Number(args[args.indexOf('--days') + 1]) || (args.includes('--days') ? 0 : 30)

const rest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.status === 204 ? ([] as T) : ((await res.json()) as T)
}

// PostgREST caps a response at its max-rows setting (1,000 here) whatever limit you ask for, so
// counting returned rows silently under-reports — it read 1,000 for a set of 9,179. Ask the database
// for the count instead of counting what fits in a page.
const countOf = async (path: string): Promise<number> => {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    method: 'HEAD', headers: { ...H, Prefer: 'count=exact', Range: '0-0' },
  })
  const total = res.headers.get('content-range')?.split('/')[1]
  return Number(total) || 0
}

interface SourceRow { id: string; tenant_id: string; source_url: string; deleted_at: string | null }

;(async () => {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const deleted = await rest<SourceRow[]>(
    `catalog_sources?select=id,tenant_id,source_url,deleted_at&deleted_at=not.is.null&deleted_at=lt.${cutoff}`,
  )

  console.log(`Sources disconnected more than ${days} day(s) ago: ${deleted.length}   ${commit ? 'COMMIT' : 'dry run'}`)
  if (!deleted.length) { console.log('Nothing to clean.'); return }

  let total = 0
  for (const src of deleted) {
    const rows = await countOf(`catalog_ingested_products?select=id&source_id=eq.${src.id}`)
    if (!rows) continue
    total += rows

    // A source with live products is NOT an orphan — it is a source someone is about to revive.
    // Only the ones a disconnect left behind are cleared.
    const live = await rest<Array<{ id: string }>>(
      `catalog_ingested_products?select=id&source_id=eq.${src.id}&is_active=eq.true&limit=1`,
    )
    const label = `${src.source_url} (disconnected ${src.deleted_at?.slice(0, 10)})`
    if (live.length) { console.log(`  SKIP  ${label} — ${rows} products, some still active`); continue }

    console.log(`  ${commit ? 'purge' : 'would purge'}  ${label} — ${rows.toLocaleString()} products`)
    if (commit) {
      await rest(`catalog_ingested_products?source_id=eq.${src.id}`, { method: 'DELETE' })
      // The source row itself stays: it is tiny, and keeping it means a later reconnect revives the
      // same row rather than starting a third one.
    }
  }

  console.log(`\n${commit ? 'Purged' : 'Would purge'}: ${total.toLocaleString()} product row(s)`)
  if (!commit) console.log('Dry run — nothing written. Re-run with --commit.')
})().catch((e) => { console.error(e.message); process.exit(1) })
