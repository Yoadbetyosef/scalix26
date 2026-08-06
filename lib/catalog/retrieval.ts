import { createAdminClient } from '@/lib/supabase/server'
import { groupProducts, speakableAnswer, tokenize, type Groupable, type ProductGroup } from './grouping'

// THE retrieval path. One implementation, three callers: the text pipeline's tool, the voice agent's
// tool, and the tenant-facing test box in /catalog. A test surface that disagrees with the agent is
// worse than no test surface, so there is deliberately no second implementation to drift from.
//
// TWO CATALOGS, ONE ANSWER. catalog_products is physical inventory — it alone knows stock and
// location. catalog_ingested_products is the website — it alone has the full range. A product in both
// is merged field by field and emitted ONCE, so the agent can never contradict itself by reading two
// rows about the same thing. Which source wins is decided here, not by the model mid-call:
//   availability + quantities → inventory (the only source that knows)
//   price                     → inventory when the owner set one, else the website
//   image, url                → whichever has one, website preferred (it has real product pages)
//
// TENANT ISOLATION: every query filters tenant_id first. There is no code path here that reads a row
// without it.

const CANDIDATE_LIMIT = 200     // pulled before ranking — a template family alone can be 30 rows
const MATCH_LIMIT = 60          // kept after ranking, enough for grouping to see a whole family
const GROUP_LIMIT = 3           // no caller wants a fourth option read to them
export const RETRIEVAL_TIMEOUT_MS = 250   // under the ~300ms voice budget, with room for the round trip

export interface RetrievalResult {
  query: string
  groups: ProductGroup[]
  /** A line the agent can say almost verbatim — never a substitute for the fields, always a shortcut. */
  say: string
  resolved: boolean
  clarifying: boolean           // resolved as a range plus a question rather than a single price
  matched: number               // rows before grouping, for the miss-rate log
  /** Ids of the rows the answer was built from — so a test surface can show exactly those and never
   *  a differently-worded second query. */
  groupIds: string[]
  latencyMs: number
  timedOut: boolean
  /** Both lookups failed. Distinct from a miss: the caller hears the same thing, but the miss-rate
   *  data must not count an outage as "the catalogue didn't have it" — that is the number deciding
   *  whether embeddings get added. */
  errored: boolean
}

interface Row extends Groupable { normalizedKey: string | null }

// A caller says "how much is the emerald cut halo ring". No row contains that as a substring — matched
// as one phrase it returns nothing, which is exactly what the Task-1 search box did.
//
// But requiring EVERY word is just as wrong, and measurably so: "pear shaped diamond ring" returns
// nothing on a catalogue full of pear-shaped rings, because no title contains the word "shaped". One
// stray word from a caller must not zero the result.
//
// So: one OR query across every token, then rank in JS by how many distinct tokens each row matched.
// Rows matching all four sort above rows matching three, which gives AND-grade precision at the top
// and degrades gracefully underneath — and it is ONE round trip rather than one per token.
const escape = (t: string) => t.replace(/[%,()\\]/g, ' ').trim()

// "studs" should find "Stud Earrings". Cheap, deterministic, and it covers the plural that English
// puts between a caller and their product.
const variants = (t: string): string[] =>
  t.length > 3 && t.endsWith('s') ? [t, t.slice(0, -1)] : [t]

// A caller saying "ring" is not naming a SKU. Searching the code column for ordinary words doubles
// the predicate count for no recall — every one of those is another pattern the database evaluates
// per row. Codes look like codes: they carry a digit, or they're a short all-caps token.
const looksLikeCode = (t: string): boolean => /\d/.test(t) || (t.length <= 6 && !/[aeiou]{2}/.test(t))

const orFilter = (titleColumn: string, skuColumn: string, tokens: string[]): string => {
  const parts: string[] = []
  for (const t of tokens) {
    for (const v of variants(t)) parts.push(`${titleColumn}.ilike.%${v}%`)
    if (looksLikeCode(t)) parts.push(`${skuColumn}.ilike.%${t}%`)
  }
  return parts.join(',')
}

// How many of the caller's words this row actually accounts for. The ranking signal.
const coverage = (haystack: string, tokens: string[]): number =>
  tokens.filter((t) => variants(t).some((v) => haystack.includes(v))).length

async function searchWebsite(tenantId: string, tokens: string[]): Promise<Row[]> {
  const db = createAdminClient()
  const { data } = await db.from('catalog_ingested_products')
    .select('id, title, price, currency, sku, image_url, product_url, availability')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .or(orFilter('title', 'sku', tokens))
    .limit(CANDIDATE_LIMIT)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    title: (r.title as string) ?? '',
    price: r.price === null ? null : Number(r.price),
    currency: (r.currency as string) ?? 'USD',
    sku: (r.sku as string) ?? null,
    availability: (r.availability as string) ?? null,
    productUrl: (r.product_url as string) ?? null,
    imageUrl: (r.image_url as string) ?? null,
    source: 'website' as const,
    normalizedKey: mergeKey(r.sku as string | null, r.title as string),
  }))
}

async function searchInventory(tenantId: string, tokens: string[]): Promise<Row[]> {
  const db = createAdminClient()
  const { data } = await db.from('catalog_products')
    .select('id, name, sku, price, availability_status, showroom_quantity, warehouse_quantity, storage_quantity, image_url')
    .eq('tenant_id', tenantId)
    .neq('status', 'discontinued')
    .or(orFilter('name', 'sku', tokens))
    .limit(CANDIDATE_LIMIT)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const onHand = Number(r.showroom_quantity ?? 0) + Number(r.warehouse_quantity ?? 0) + Number(r.storage_quantity ?? 0)
    return {
      id: r.id as string,
      title: (r.name as string) ?? '',
      price: r.price === null ? null : Number(r.price),
      currency: 'USD',
      sku: (r.sku as string) ?? null,
      availability: (r.availability_status as string) ?? null,
      productUrl: null,
      imageUrl: (r.image_url as string) ?? null,
      source: 'inventory' as const,
      inStock: onHand,
      normalizedKey: mergeKey(r.sku as string | null, r.name as string),
    }
  })
}

// What makes two rows "the same product" across the two tables. SKU when both have one — that is the
// only identifier a business actually maintains in both places. Otherwise an exact normalized title,
// which is conservative on purpose: a false merge would attach the wrong stock count to a price.
const mergeKey = (sku: string | null, title: string): string | null => {
  const s = (sku ?? '').trim().toLowerCase()
  if (s) return `sku:${s}`
  const t = (title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return t ? `title:${t}` : null
}

function mergeRows(website: Row[], inventory: Row[]): Groupable[] {
  const byKey = new Map<string, Groupable>()
  const out: Groupable[] = []

  for (const r of website) {
    if (r.normalizedKey) byKey.set(r.normalizedKey, r)
    out.push(r)
  }

  for (const inv of inventory) {
    const hit = inv.normalizedKey ? byKey.get(inv.normalizedKey) : undefined
    if (!hit) { out.push(inv); continue }
    // Same product, two records → ONE answer. Inventory decides availability because it is the only
    // source that knows; the website keeps the link and the image because it has the real page.
    hit.availability = inv.availability ?? hit.availability
    hit.inStock = inv.inStock ?? null
    hit.price = inv.price ?? hit.price
    hit.sku = hit.sku ?? inv.sku
    hit.imageUrl = hit.imageUrl ?? inv.imageUrl
    hit.source = 'both'
  }
  return out
}

// The miss-rate log. Fire-and-forget: instrumentation must never delay a caller, and it must never be
// the reason a lookup fails. Deferring embeddings is only honest while this keeps recording.
function logRetrieval(tenantId: string, surface: 'voice' | 'text' | 'test', query: string, normalized: string, r: Omit<RetrievalResult, 'query' | 'groups' | 'say'>): void {
  void createAdminClient().from('catalog_retrieval_log').insert({
    tenant_id: tenantId, query: query.slice(0, 500), normalized: normalized.slice(0, 500), surface,
    matched: r.matched, groups: 0, resolved: r.resolved, clarifying: r.clarifying,
    latency_ms: Math.round(r.latencyMs), timed_out: r.timedOut, errored: r.errored,
  }).then(() => {}, () => {})
}

const MISS: Omit<RetrievalResult, 'query'> = {
  groups: [], say: '', resolved: false, clarifying: false, matched: 0, groupIds: [], latencyMs: 0, timedOut: false, errored: false,
}

/**
 * Look up what a caller asked for, across both catalogs, and return something speakable.
 * Never throws: a failure is a miss, because a miss is answerable and an exception is not.
 */
export async function retrieveProducts(
  tenantId: string,
  query: string,
  surface: 'voice' | 'text' | 'test' = 'text',
): Promise<RetrievalResult> {
  const started = Date.now()
  const tokens = tokenize(query).map(escape).filter(Boolean).slice(0, 8)

  if (!tenantId || !tokens.length) {
    return { ...MISS, query, say: noMatch(query), latencyMs: Date.now() - started }
  }

  let timedOut = false
  let errored = false
  let rows: Groupable[] = []
  try {
    // A stalled lookup is worse than a miss: the caller hears silence either way, and the miss at
    // least lets the agent move the conversation on.
    rows = await Promise.race([
      (async () => {
        // One table failing must not blank the other — but both failing is an outage, and it is
        // recorded as one rather than quietly logged as "no such product".
        const [website, inventory] = await Promise.allSettled([
          searchWebsite(tenantId, tokens),
          searchInventory(tenantId, tokens),
        ])
        if (website.status === 'rejected' && inventory.status === 'rejected') errored = true
        const merged = mergeRows(
          website.status === 'fulfilled' ? website.value : [],
          inventory.status === 'fulfilled' ? inventory.value : [],
        )
        // Rank by how much of what the caller said each row accounts for, then keep the top slice.
        // Everything below the best coverage is a partial match on one stray word.
        const scored = merged.map((r) => ({ r, score: coverage(`${r.title} ${r.sku ?? ''}`.toLowerCase(), tokens) }))
        const best = scored.reduce((m, s2) => Math.max(m, s2.score), 0)
        return scored
          .filter((s2) => s2.score === best)
          .slice(0, MATCH_LIMIT)
          .map((s2) => s2.r)
      })(),
      new Promise<Groupable[]>((resolve) => setTimeout(() => { timedOut = true; resolve([]) }, RETRIEVAL_TIMEOUT_MS)),
    ])
  } catch { rows = []; errored = true }

  const groups = groupProducts(rows, GROUP_LIMIT)
  const latencyMs = Date.now() - started
  const resolved = groups.length > 0
  const clarifying = resolved && groups[0].count > 1

  const result: RetrievalResult = {
    query,
    groups,
    say: resolved ? speakableAnswer(groups[0]) : noMatch(query),
    resolved,
    clarifying,
    matched: rows.length,
    groupIds: rows.map((r) => r.id).slice(0, 60),
    latencyMs,
    timedOut,
    errored,
  }
  logRetrieval(tenantId, surface, query, tokens.join(' '), result)
  return result
}

// An explicit miss the agent can voice. Never a hallucinated product, and never an apology loop —
// it hands the caller a next step.
const noMatch = (query: string): string =>
  `I don't see ${query.trim() ? `"${query.trim()}"` : 'that'} in our catalog. I can check with the team and get back to you.`

/** Compact JSON for a tool result — small, because the model reads it mid-sentence. */
export function toToolPayload(r: RetrievalResult): string {
  if (!r.resolved) return JSON.stringify({ found: false, say: r.say })
  return JSON.stringify({
    found: true,
    say: r.say,
    matches: r.groups.map((g) => ({
      product: g.label,
      versions: g.count,
      price: g.priceMin === g.priceMax ? g.priceMin : undefined,
      price_from: g.priceMin !== g.priceMax ? g.priceMin : undefined,
      price_to: g.priceMin !== g.priceMax ? g.priceMax : undefined,
      currency: g.currency,
      varies_by: g.axis ?? undefined,
      options: g.axisValues.length ? g.axisValues : undefined,
      availability: g.availability ?? undefined,
      in_stock: g.inStock ?? undefined,
      sku: g.sku ?? undefined,
    })),
  })
}
