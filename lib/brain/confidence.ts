import type { EvidenceStrength } from './types'

// ── Business Confidence (deterministic — NOT model confidence) ────────────────────
// Derived purely from real business evidence: how much, how consistent, over how long,
// and how outcome-linked. Thin data → honestly low. Owners trust it because it's evidence.

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const WEEK_MS = 7 * 864e5

// Timing stats from a set of evidence timestamps (ms): how long observed + how steady.
export function timeStats(datesMs: number[]): { weeksObserved: number; consistency: number } {
  if (!datesMs.length) return { weeksObserved: 0, consistency: 0.4 }
  const min = Math.min(...datesMs), max = Math.max(...datesMs)
  const weeksObserved = Math.max(datesMs.length >= 2 ? (max - min) / WEEK_MS : 0, datesMs.length ? 0.5 : 0)
  if (datesMs.length < 3) return { weeksObserved, consistency: 0.45 }
  // Weekly buckets → coefficient of variation of the per-week counts (steady = high consistency).
  const buckets = new Map<number, number>()
  for (const d of datesMs) { const b = Math.floor((d - min) / WEEK_MS); buckets.set(b, (buckets.get(b) || 0) + 1) }
  const counts = [...buckets.values()]
  if (counts.length < 2) return { weeksObserved, consistency: 0.5 }
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length
  const variance = counts.reduce((a, c) => a + (c - mean) ** 2, 0) / counts.length
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1
  return { weeksObserved, consistency: clamp(1 - cv / 2, 0.2, 0.95) }
}

/**
 * 0..100. Geometric mean of volume × timespan × consistency (any weak factor drags the whole
 * score down — deliberately honest), with a small outcome bonus. No LLM, no randomness.
 */
export function businessConfidence(p: { evidenceCount: number; weeksObserved: number; consistency: number; outcomeRatio: number }): number {
  const volume = 1 - Math.exp(-p.evidenceCount / 40)       // 40 records ≈ 63%, 120 ≈ 95%
  const timespan = clamp(p.weeksObserved / 8, 0, 1)        // needs ~8 weeks to fully trust
  const consistency = clamp(p.consistency, 0, 1)
  const core = Math.cbrt(Math.max(0.02, volume) * Math.max(0.05, timespan) * Math.max(0.1, consistency))
  const outcomeBoost = 0.85 + 0.15 * clamp(p.outcomeRatio, 0, 1)
  return Math.round(clamp(core * outcomeBoost * 100, 1, 99))
}

export function evidenceStrength(confidence: number, evidenceCount: number, weeksObserved: number): EvidenceStrength {
  if (confidence >= 80 && evidenceCount >= 100 && weeksObserved >= 6) return 'Very High'
  if (confidence >= 60 && evidenceCount >= 30) return 'High'
  if (confidence >= 35 && evidenceCount >= 8) return 'Medium'
  return 'Low'
}

export function evidenceSummary(parts: { conversations?: number; payments?: number; appointments?: number; leads?: number; weeksObserved: number }): string {
  const s: string[] = []
  if (parts.conversations) s.push(`${parts.conversations} conversations`)
  if (parts.leads) s.push(`${parts.leads} leads`)
  if (parts.appointments) s.push(`${parts.appointments} appointments`)
  if (parts.payments) s.push(`${parts.payments} payments`)
  const weeks = Math.max(1, Math.round(parts.weeksObserved))
  s.push(`${weeks} week${weeks === 1 ? '' : 's'} of data`)
  return s.join(' · ')
}
