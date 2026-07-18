// Pure duplicate-detection scoring over already-normalized contact keys. Unit-tested; no I/O.
// Strong signals: exact normalized phone or email. Weak signal: identical non-empty name.

export interface DedupeCandidate { id: string; name?: string | null; normalized_phone?: string | null; normalized_email?: string | null }
export interface DuplicateMatch { id: string; score: number; reasons: string[] }

export function scoreDuplicate(a: DedupeCandidate, b: DedupeCandidate): DuplicateMatch | null {
  if (a.id === b.id) return null
  let score = 0
  const reasons: string[] = []
  if (a.normalized_phone && b.normalized_phone && a.normalized_phone === b.normalized_phone) { score += 0.7; reasons.push('phone') }
  if (a.normalized_email && b.normalized_email && a.normalized_email === b.normalized_email) { score += 0.7; reasons.push('email') }
  const an = (a.name || '').trim().toLowerCase(), bn = (b.name || '').trim().toLowerCase()
  if (an && an === bn) { score += 0.2; reasons.push('name') }
  if (score === 0) return null
  return { id: b.id, score: Math.min(1, score), reasons }
}

// Rank likely duplicates of `candidate` among `others` (highest score first).
export function findDuplicates(candidate: DedupeCandidate, others: DedupeCandidate[], minScore = 0.5): DuplicateMatch[] {
  return others
    .map((o) => scoreDuplicate(candidate, o))
    .filter((m): m is DuplicateMatch => m !== null && m.score >= minScore)
    .sort((x, y) => y.score - x.score)
}
