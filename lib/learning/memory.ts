import type { SupabaseClient } from '@supabase/supabase-js'
import type { Representative } from './select'

// ── Cumulative Business Memory (C) ───────────────────────────────────────────────
// Durable, per-pattern knowledge that STRENGTHENS over time instead of restarting. Every
// distinct customer/owner pattern is stored once, keyed by a deterministic pattern_hash.
// When the same pattern appears again we do NOT pay an LLM to rediscover it — we bump its
// evidence_count, nudge its confidence up, and update last_seen_at. Only genuinely novel
// (or meaningfully different) patterns are allowed to reach paid synthesis.

export interface MemoryEntry {
  id?: string
  tenant_id: string
  ai_employee_id: string | null
  facet: string
  dimension: string
  pattern_hash: string
  pattern_key: string
  tokens: string[]
  statement: string
  channels: string[]
  evidence_count: number
  confidence: number
  first_seen_at: string
  last_seen_at: string
  last_evidence: Record<string, unknown>
  suggestion_id: string | null
  status: string
}

export interface PatternMatch { rep: Representative; entry: MemoryEntry; kind: 'known' | 'similar' }
export interface Partition { known: PatternMatch[]; similar: PatternMatch[]; novel: Representative[] }

const SIMILAR_THRESHOLD = 0.82

// ── Pure helpers (no DB — unit-testable) ─────────────────────────────────────────

/** Token-set overlap. 1.0 = identical wording, 0 = nothing in common. */
export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const A = new Set(a), B = new Set(b)
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

/**
 * Deterministic, bounded, monotonic confidence reinforcement. Each time a pattern recurs,
 * confidence moves a fraction of the way toward certainty — with diminishing returns and a
 * hard ceiling. No LLM, no randomness. Knowledge evolves; it never resets.
 */
export function reinforceConfidence(current: number, addedEvidence: number): number {
  const n = Math.max(1, Math.min(addedEvidence, 8))
  const step = 1 - Math.pow(0.88, n) // ~0.12 for one repeat … ~0.64 for a burst of 8
  return Math.min(0.98, current + step * (1 - current))
}

/**
 * Split incoming patterns into: KNOWN (exact pattern_hash already in memory), SIMILAR
 * (same facet, wording overlap ≥ threshold — merge into the existing entry, don't
 * duplicate), and NOVEL (never seen — the only ones that may cost an LLM call).
 */
export function partitionPatterns(reps: Representative[], memory: MemoryEntry[], threshold = SIMILAR_THRESHOLD): Partition {
  const byHash = new Map(memory.map((e) => [e.pattern_hash, e]))
  const byFacet = new Map<string, MemoryEntry[]>()
  for (const e of memory) { const a = byFacet.get(e.facet) || []; a.push(e); byFacet.set(e.facet, a) }

  const known: PatternMatch[] = [], similar: PatternMatch[] = [], novel: Representative[] = []
  for (const rep of reps) {
    const exact = byHash.get(rep.patternHash)
    if (exact) { known.push({ rep, entry: exact, kind: 'known' }); continue }
    let best: { entry: MemoryEntry; score: number } | null = null
    for (const e of byFacet.get(rep.facet) || []) {
      const score = jaccard(rep.tokens, e.tokens)
      if (score >= threshold && (!best || score > best.score)) best = { entry: e, score }
    }
    if (best) similar.push({ rep, entry: best.entry, kind: 'similar' })
    else novel.push(rep)
  }
  return { known, similar, novel }
}

/** Build a fresh memory entry for a novel pattern (before it is persisted). */
export function newEntry(tenantId: string, agentId: string | null, rep: Representative, statement: string): MemoryEntry {
  const now = new Date().toISOString()
  return {
    tenant_id: tenantId, ai_employee_id: agentId, facet: rep.facet, dimension: rep.facet,
    pattern_hash: rep.patternHash, pattern_key: rep.patternKey, tokens: rep.tokens,
    statement: statement.slice(0, 500), channels: rep.channel ? [rep.channel] : [],
    evidence_count: rep.frequency, confidence: 0.45,
    first_seen_at: now, last_seen_at: now, last_evidence: { conversation_id: rep.id }, suggestion_id: null, status: 'active',
  }
}

// ── DB ops (best-effort — degrade cleanly if the table isn't migrated) ────────────

export async function loadMemory(admin: SupabaseClient, tenantId: string, agentId: string | null): Promise<MemoryEntry[]> {
  try {
    let q = admin.from('business_memory').select('*').eq('tenant_id', tenantId).limit(4000)
    q = agentId ? q.or(`ai_employee_id.eq.${agentId},ai_employee_id.is.null`) : q
    const { data } = await q
    return (data as MemoryEntry[]) || []
  } catch { return [] }
}

/**
 * Reinforce matched patterns WITHOUT any LLM: evidence_count += frequency, confidence
 * nudged up, last_seen_at + evidence refreshed. Returns how much LLM cost this avoided is
 * computed by the caller. Batched updates.
 */
export async function reinforceMatches(admin: SupabaseClient, matches: PatternMatch[]): Promise<void> {
  const now = new Date().toISOString()
  for (const { rep, entry } of matches) {
    if (!entry.id) continue
    const evidence_count = entry.evidence_count + rep.frequency
    const confidence = reinforceConfidence(entry.confidence, rep.frequency)
    try {
      await admin.from('business_memory').update({
        evidence_count, confidence, last_seen_at: now,
        last_evidence: { conversation_id: rep.id, frequency: rep.frequency },
        updated_at: now,
      }).eq('id', entry.id)
    } catch { /* best-effort */ }
  }
}

/** Persist novel patterns as new memory entries. Returns the entries (with ids when available). */
export async function insertNovel(admin: SupabaseClient, entries: MemoryEntry[]): Promise<MemoryEntry[]> {
  if (!entries.length) return []
  try {
    const { data } = await admin.from('business_memory')
      .upsert(entries.map((e) => ({ ...e, updated_at: e.last_seen_at })), { onConflict: 'tenant_id,pattern_hash' })
      .select('id, pattern_hash')
    const idByHash = new Map((data || []).map((d) => [d.pattern_hash as string, d.id as string]))
    return entries.map((e) => ({ ...e, id: idByHash.get(e.pattern_hash) ?? e.id }))
  } catch { return entries }
}

export async function linkSuggestion(admin: SupabaseClient, patternHash: string, tenantId: string, suggestionId: string): Promise<void> {
  try {
    await admin.from('business_memory').update({ suggestion_id: suggestionId })
      .eq('tenant_id', tenantId).eq('pattern_hash', patternHash)
  } catch { /* best-effort */ }
}
