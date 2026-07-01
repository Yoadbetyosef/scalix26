import { contentHash } from './dedupe'

// ── Cheap deterministic pre-processing (points 2, 3 & the "200 asks = 1 event" lever) ──
// Before anything reaches the LLM we do all the work that doesn't need one: normalize,
// collapse repeated questions into a single representative (with a frequency count),
// cluster by topic for prioritization, and sample a small representative set. Only the
// representatives are sent to the model; everything else is aggregate stats + counts.

export interface ConvLike {
  id: string
  channel: string | null
  human_takeover?: boolean | null
  sentiment?: string | null
  messages: { role: string; content: string }[]
}

export interface Representative extends ConvLike {
  frequency: number // how many near-identical conversations this one stands in for
  patternKey: string // channel|facet|normalized-question — the deterministic pattern identity
  patternHash: string // sha256(patternKey) — the key cumulative memory matches on
  tokens: string[] // normalized token set of the question — used for fuzzy "similar" matching
  facet: string // coarse topic cluster (pricing, booking, complaint, …)
}

export function tokenize(normalized: string): string[] {
  return [...new Set(normalized.split(' ').filter((t) => t.length > 1))]
}

export interface Selection {
  representatives: Representative[]
  hashes: string[] // content hash per representative (for the dedupe ledger)
  stats: {
    scanned: number
    deduplicated: number // near-duplicate conversations collapsed away
    distinctPatterns: number
    byChannel: Record<string, number>
    byCluster: Record<string, number>
  }
  statsLine: string
}

const CLUSTERS: { key: string; re: RegExp }[] = [
  { key: 'pricing', re: /\b(price|pricing|cost|how much|quote|estimate|charge|rate|fee|deposit|\$\s?\d)/i },
  { key: 'booking', re: /\b(book|schedule|appointment|availab|come out|slot|reschedul|cancel)\b/i },
  { key: 'complaint', re: /\b(refund|complaint|angry|terrible|worst|disappointed|unacceptable|rude|late)\b/i },
  { key: 'hours_location', re: /\b(hours|open|closed|where|located|address|directions|area)\b/i },
  { key: 'service_scope', re: /\b(do you|can you|offer|handle|service|available for|able to)\b/i },
]
const PRIORITY = ['owner_takeover', 'complaint', 'pricing', 'booking', 'service_scope', 'hours_location', 'other']

function transcript(c: ConvLike): string {
  return c.messages.map((m) => `${m.role}: ${m.content}`).join('\n')
}
function firstQuestion(c: ConvLike): string {
  const u = c.messages.find((m) => m.role === 'user')
  return (u?.content || transcript(c)).slice(0, 400)
}
// Aggressive normalization so "How much for a lockout?!" == "how much for a lockout" and
// numbers don't split otherwise-identical questions apart.
function normalize(s: string): string {
  return s.toLowerCase().replace(/\d+/g, '#').replace(/[^a-z#\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
}
function clusterOf(text: string, takeover: boolean): string {
  if (takeover) return 'owner_takeover'
  for (const c of CLUSTERS) if (c.re.test(text)) return c.key
  return 'other'
}

/** Collapse a raw batch into deduped, frequency-weighted representatives capped at `sample`. */
export function selectConversations(convs: ConvLike[], sample: number): Selection {
  const byChannel: Record<string, number> = {}
  const byCluster: Record<string, number> = {}
  // Group by normalized-question pattern so repeats become ONE representative.
  const groups = new Map<string, { rep: ConvLike; count: number; cluster: string; norm: string; key: string }>()

  for (const c of convs) {
    const full = transcript(c)
    byChannel[c.channel || 'unknown'] = (byChannel[c.channel || 'unknown'] || 0) + 1
    const cluster = clusterOf(full, !!c.human_takeover)
    byCluster[cluster] = (byCluster[cluster] || 0) + 1
    const norm = normalize(firstQuestion(c))
    const key = `${c.channel || '?'}|${cluster}|${norm}`
    const g = groups.get(key)
    if (g) { g.count += 1 } // a repeat of an already-seen question → just bump frequency
    else groups.set(key, { rep: c, count: 1, cluster, norm, key })
  }

  // Order distinct patterns: high-signal clusters first, then by frequency (most common first).
  const patterns = [...groups.values()].sort((a, b) => {
    const pa = PRIORITY.indexOf(a.cluster), pb = PRIORITY.indexOf(b.cluster)
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || b.count - a.count
  })

  const representatives: Representative[] = []
  const hashes: string[] = []
  for (const p of patterns.slice(0, sample)) {
    const patternHash = contentHash(p.key)
    representatives.push({ ...p.rep, frequency: p.count, patternKey: p.key, patternHash, tokens: tokenize(p.norm), facet: p.cluster })
    hashes.push(patternHash)
  }

  const statsLine =
    `scanned=${convs.length} distinct=${groups.size} collapsed=${convs.length - groups.size} ` +
    `channels={${Object.entries(byChannel).map(([k, v]) => `${k}:${v}`).join(', ')}} ` +
    `topics={${Object.entries(byCluster).map(([k, v]) => `${k}:${v}`).join(', ')}}`

  return {
    representatives,
    hashes,
    stats: { scanned: convs.length, deduplicated: convs.length - groups.size, distinctPatterns: groups.size, byChannel, byCluster },
    statsLine,
  }
}
