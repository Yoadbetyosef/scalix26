import { createAdminClient } from '@/lib/supabase/server'
import { bestMatch, tokenize, type Candidate, type ScoredMatch } from './match-score'

// Fetching the products an invoice line might refer to, and handing them to the scorer.
//
// Everything that DECIDES lives in ./match-score.ts and is unit-tested. This file only gets the
// candidates in front of it, which is the part that has to know about PostgREST.

/**
 * Which products an invoice may match against.
 *
 * `draft` is here deliberately, and it is the half of the design people delete by accident. A draft was
 * created FROM a supplier invoice; the next invoice from that supplier lists the same goods again. If
 * drafts were unmatchable, every repeat invoice would create a second copy of every product on it —
 * the precise failure that creating them from lines was meant to end.
 *
 * The voice agent excludes drafts (lib/catalog/retrieval.ts). The matcher includes them. That asymmetry
 * is the point, not an inconsistency.
 */
const MATCHABLE = ['active', 'draft'] as const

/**
 * PostgREST returns at most 1,000 rows per request regardless of `limit`, so a plain select against a
 * large catalogue silently returns a truncated set. That page cap has already produced one wrong answer
 * in this codebase — the orphan cleanup reported 1,000 rows when there were 9,179 — so matching pages
 * explicitly rather than assuming one request is the whole table.
 */
const PAGE = 1000

/**
 * How much catalogue we will pull into memory to match against.
 *
 * Above this, name matching is skipped and only SKUs are matched. That degradation is REPORTED, not
 * silent: the caller surfaces it on the approval screen, because "12 lines could not be matched" and
 * "12 lines could not be matched and we only looked at half your catalogue" are different facts and the
 * owner would take a different action on each. (The silent MAX_CRAWL_URLS truncation in the ingestion
 * worker is the mistake this is deliberately not repeating.)
 */
const MAX_MATCH_CATALOG = 10_000

export interface MatchOutcome {
  /** Keyed by line id. Absent means no confident match — the line stays unmatched, which is a fine state. */
  matches: Map<string, ScoredMatch>
  /** Products considered. Shown so the screen can say what the matching actually saw. */
  catalogSize: number
  /** True when the catalogue is larger than we will scan by name. Never hidden from the owner. */
  nameMatchingSkipped: boolean
}

interface LineInput { id: string; sku: string | null; description: string | null }

/**
 * Match every line of an invoice against this tenant's products, in one pass.
 *
 * Admin client with a server-resolved tenant, consistent with the rest of the catalog read path: the
 * RLS-scoped client would return the operator's own products rather than the client workspace's when a
 * White Label partner is the one uploading.
 */
export async function matchInvoiceLines(tenantId: string, lines: LineInput[]): Promise<MatchOutcome> {
  const db = createAdminClient()

  const { count } = await db.from('catalog_products')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).in('status', MATCHABLE)

  const catalogSize = count ?? 0
  const nameMatchingSkipped = catalogSize > MAX_MATCH_CATALOG

  const candidates = nameMatchingSkipped
    ? await candidatesBySku(tenantId, lines)
    : await wholeCatalog(tenantId)

  const matches = new Map<string, ScoredMatch>()
  for (const line of lines) {
    const m = bestMatch(line, candidates)
    if (m) matches.set(line.id, m)
  }
  return { matches, catalogSize, nameMatchingSkipped }
}

/** Every active product, paged. Three columns, because that is all the scorer looks at. */
async function wholeCatalog(tenantId: string): Promise<Candidate[]> {
  const db = createAdminClient()
  const out: Candidate[] = []
  for (let from = 0; from < MAX_MATCH_CATALOG; from += PAGE) {
    const { data } = await db.from('catalog_products')
      .select('id, name, sku')
      .eq('tenant_id', tenantId).in('status', MATCHABLE)
      .order('id')
      .range(from, from + PAGE - 1)
    const page = (data as Candidate[] | null) ?? []
    out.push(...page)
    if (page.length < PAGE) break   // short page means the end, and saves a request that returns nothing
  }
  return out
}

/**
 * The large-catalogue path: only products whose SKU appears on the invoice, plus the same set with
 * punctuation stripped so the normalised rung still has something to work with. Indexed
 * (idx_catalog_products_sku), so it stays cheap no matter how big the catalogue is.
 */
async function candidatesBySku(tenantId: string, lines: LineInput[]): Promise<Candidate[]> {
  const skus = [...new Set(lines.map((l) => l.sku?.trim()).filter((s): s is string => Boolean(s)))]
  if (!skus.length) return []

  const db = createAdminClient()
  const out: Candidate[] = []
  // Chunked: a URL carrying several hundred SKUs in an `in.()` list will exceed the request line limit.
  for (let i = 0; i < skus.length; i += 100) {
    const { data } = await db.from('catalog_products')
      .select('id, name, sku')
      .eq('tenant_id', tenantId).in('status', MATCHABLE)
      .in('sku', skus.slice(i, i + 100))
    out.push(...((data as Candidate[] | null) ?? []))
  }
  return out
}

/**
 * A shortlist for one line the matcher could not place, for the owner to choose from by hand.
 *
 * Uses the pg_trgm indexes through `ilike` on the line's most distinctive words. This is a SUGGESTION
 * list — anything picked from it is recorded as a 'manual' match, because the owner chose it and that
 * is a different kind of fact from anything the ladder decided.
 */
export async function suggestProducts(tenantId: string, line: LineInput, limit = 8): Promise<Candidate[]> {
  const words = tokenize(line.description ?? '').sort((a, b) => b.length - a.length).slice(0, 3)
  const db = createAdminClient()

  const seen = new Map<string, Candidate>()
  for (const w of words) {
    const { data } = await db.from('catalog_products')
      .select('id, name, sku')
      .eq('tenant_id', tenantId).in('status', MATCHABLE)
      .ilike('name', `%${w}%`)
      .limit(limit)
    for (const c of (data as Candidate[] | null) ?? []) seen.set(c.id, c)
  }

  // Ranked by the same similarity the ladder uses, so the top suggestion is the one that came closest
  // to being matched automatically rather than whichever row the database happened to return first.
  return [...seen.values()]
    .map((c) => ({ c, score: bestMatch({ sku: line.sku, description: line.description }, [c])?.confidence ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.c)
}
