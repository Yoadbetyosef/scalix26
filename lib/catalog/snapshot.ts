import { createAdminClient } from '@/lib/supabase/server'

// For a small catalogue, retrieval is the wrong shape entirely. A locksmith with 40 products can have
// the whole list in the agent's head before the call connects: zero runtime latency, zero lookups,
// nothing to time out mid-sentence. The tool still exists for the cases the prompt can't cover, but
// most questions are answered without ever calling it.
//
// Built on the WEB path, at prompt-assembly time — not in the worker. Prompt assembly already happens
// at call SETUP (see the Twilio voice webhook), so this costs a caller nothing, and the ingestion
// worker stays untouched.

// Above this, the list stops fitting a prompt and starts crowding out everything else in it.
// A number, not a magic one: ~80 products is roughly 3,000 tokens of catalogue.
export const SNAPSHOT_MAX_PRODUCTS = 80

interface CachedSnapshot { text: string; syncedAt: string | null; builtAt: number }

// Keyed by tenant and invalidated by last_synced_at: a sync that changed nothing leaves the timestamp
// moving but the text identical, so the cache is also a cheap way to avoid rebuilding on every call.
const cache = new Map<string, CachedSnapshot>()
const CACHE_TTL_MS = 10 * 60_000

const money = (p: number | null, currency: string): string => {
  if (p === null) return 'price on request'
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : ''
  return symbol ? `${symbol}${p.toLocaleString('en-US')}` : `${p.toLocaleString('en-US')} ${currency}`
}

/**
 * The tenant's website catalogue as a few lines of prompt, or null when there are too many products
 * (in which case the agent uses the search_catalog tool instead) or none at all.
 */
export async function catalogSnapshot(tenantId: string): Promise<string | null> {
  const db = createAdminClient()

  // One cheap read decides everything: how many products, and when they last changed.
  const [{ count }, { data: sources }] = await Promise.all([
    db.from('catalog_ingested_products').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('is_active', true),
    db.from('catalog_sources').select('last_synced_at').eq('tenant_id', tenantId).is('deleted_at', null),
  ])

  const total = count ?? 0
  if (total === 0 || total > SNAPSHOT_MAX_PRODUCTS) return null

  const syncedAt = (sources ?? [])
    .map((s) => s.last_synced_at as string | null)
    .filter(Boolean)
    .sort()
    .pop() ?? null

  const hit = cache.get(tenantId)
  if (hit && hit.syncedAt === syncedAt && Date.now() - hit.builtAt < CACHE_TTL_MS) return hit.text

  const { data } = await db.from('catalog_ingested_products')
    .select('title, price, currency, sku, availability')
    .eq('tenant_id', tenantId).eq('is_active', true)
    .order('title')
    .limit(SNAPSHOT_MAX_PRODUCTS)

  const lines = (data ?? []).map((p) => {
    const bits = [`- ${p.title as string}`, money(p.price === null ? null : Number(p.price), (p.currency as string) || 'USD')]
    if (p.sku) bits.push(`SKU ${p.sku as string}`)
    if (p.availability === 'out_of_stock') bits.push('out of stock')
    return bits.join(' — ')
  })
  if (!lines.length) return null

  const text = [
    `PRODUCTS (${lines.length}, from the business's own website — this is the complete list):`,
    ...lines,
    'Quote these prices exactly. If a caller asks for something not on this list, say you don\'t see it and offer to check with the team.',
  ].join('\n')

  cache.set(tenantId, { text, syncedAt, builtAt: Date.now() })
  return text
}
