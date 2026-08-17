// Deciding whether an invoice line refers to a product we already stock.
//
// PURE and ISOMORPHIC — no database, no session. The queries live in ./match.ts; everything that makes
// a judgement lives here, so every judgement is testable.
//
// ── WHY THE LLM DOES NOT DO THIS ────────────────────────────────────────────────────────────────────
//
// The model extracts the document and stops there. Matching is code, on purpose. A match is the step
// that decides which product's cost gets rewritten, and when it goes wrong the owner has to be able to
// see WHY — "SKU matched exactly", "name is 72% similar" — and overrule it. A model's answer is a
// judgement with no handle on it: nothing to threshold, nothing to explain in the UI, and no way to
// tell a confident right answer from a confident wrong one. Deterministic matching is also free, and
// re-runs identically when the owner fixes a SKU and asks again.

/** A SKU as the two systems might each have typed it. Case, spaces, dashes and dots are noise. */
export const normalizeSku = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

const STOP = new Set(['the', 'and', 'for', 'with', 'in', 'of', 'a', 'an', 'x', 'pcs', 'pc', 'set'])

/** Words worth comparing: lowercased, punctuation dropped, filler and one-character noise removed. */
export function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
}

/** Character trigrams of a normalised string, padded so short words still have shape. */
function trigrams(s: string): Set<string> {
  const padded = `  ${s.trim()} `
  const out = new Set<string>()
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3))
  return out
}

/**
 * Trigram similarity, 0–1 — the same shape as Postgres pg_trgm's `similarity()`: the size of the
 * intersection over the size of the union.
 *
 * Deliberately mirrors pg_trgm because the candidate query in ./match.ts uses the trigram indexes to
 * FETCH candidates and this scores them. Two different notions of similarity across those two steps
 * would mean the best match could be filtered out before it was ever scored.
 */
export function similarity(a: string, b: string): number {
  const ta = trigrams(a.toLowerCase())
  const tb = trigrams(b.toLowerCase())
  if (!ta.size || !tb.size) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / (ta.size + tb.size - shared)
}

export type MatchMethod = 'exact_sku' | 'normalized_sku' | 'name_trigram' | 'manual'

export interface Candidate { id: string; name: string; sku: string | null }
export interface ScoredMatch { productId: string; method: MatchMethod; confidence: number }

/**
 * A name match must clear this to be offered at all. Below it the line stays unmatched and the owner
 * matches by hand — which is the correct outcome, not a failure: a wrong match silently rewrites the
 * cost of a product that was never on this shipment, and no screen would show that it had happened.
 */
export const NAME_THRESHOLD = 0.45

/**
 * And it must beat the runner-up by this much. "Oak Dining Chair" against a catalogue holding "Oak
 * Dining Chair — Natural" and "Oak Dining Chair — Walnut" scores nearly the same on both; picking
 * either is a coin toss dressed up as a match. Ambiguity is reported as no match, and the approval
 * screen asks.
 */
export const AMBIGUITY_MARGIN = 0.08

/**
 * The best match for one line, or null.
 *
 * A ladder, strongest rung first — the same shape as the retrieval fallback in lib/catalog/retrieval.ts.
 * Every rung records HOW it matched, because the approval screen shows the owner the reason and not
 * just the result, and "matched on SKU" and "name looks 61% similar" deserve different amounts of trust.
 */
export function bestMatch(
  line: { sku: string | null; description: string | null },
  candidates: Candidate[],
): ScoredMatch | null {
  // 1. The SKUs agree exactly. Nothing beats this and nothing else is considered.
  if (line.sku) {
    const exact = candidates.find((c) => c.sku && c.sku.trim().toLowerCase() === line.sku!.trim().toLowerCase())
    if (exact) return { productId: exact.id, method: 'exact_sku', confidence: 1 }

    // 2. They agree once punctuation and case stop counting: "TG-1042/B" and "tg1042b".
    const n = normalizeSku(line.sku)
    if (n.length >= 3) {
      const norm = candidates.filter((c) => c.sku && normalizeSku(c.sku) === n)
      // Only when it identifies ONE product. Two products normalising to the same SKU is a catalogue
      // problem, and guessing between them here would hide it.
      if (norm.length === 1) return { productId: norm[0].id, method: 'normalized_sku', confidence: 0.95 }
    }
  }

  // 3. The description looks like a product name. The weakest rung, and the only one with a threshold.
  if (!line.description) return null
  const scored = candidates
    .map((c) => ({ c, score: similarity(line.description!, c.name) }))
    .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id))

  const top = scored[0]
  if (!top || top.score < NAME_THRESHOLD) return null
  if (scored[1] && top.score - scored[1].score < AMBIGUITY_MARGIN) return null

  return { productId: top.c.id, method: 'name_trigram', confidence: top.score }
}
