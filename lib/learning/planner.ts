import { LEARNING, type ModelTier, type LearningPhase } from './config'
import { estimateCost } from './cost'
import type { Representative } from './select'
import { partitionPatterns, type MemoryEntry, type PatternMatch } from './memory'

// ── LearningPolicy Planner (B) ───────────────────────────────────────────────────
// The self-managing brain. Given the clustered patterns, cumulative memory, and the job's
// hard cost cap, it decides — with NO human and NO LLM — the smartest way to learn the
// business while staying under the cap:
//   • skip what's already known (reinforce for free)
//   • synthesize only novel patterns
//   • process the highest-VALUE novel patterns first
//   • route low-value patterns to Haiku to fit more under the cap
//   • defer whatever still doesn't fit (resumes in the next job)
// It never asks an administrator and never exceeds the cap.

export interface PlanItem { rep: Representative; model: ModelTier }
export interface LearningPlan {
  known: PatternMatch[]
  similar: PatternMatch[]
  novel: Representative[]
  processNow: PlanItem[]
  deferred: Representative[]
  estimatedCostUSD: number // cost of processNow
  estimatedIfNaiveUSD: number // cost if we synthesized EVERY pattern with the strong model (no memory)
  costSavedUSD: number // savings from skip-known + skip-similar + deferral + Haiku routing
  willFit: boolean
  samplesConsidered: number
  notes: string[]
}

// Amortized per-pattern token footprint inside a batched synthesis call.
const PER_PATTERN_IN = 350
const OVERHEAD_IN = 800 // playbook + instructions, shared across a chunk
const OUT_PER_CHUNK = 1500

function perPatternCost(model: ModelTier): number {
  const modelId = model === 'cheap' ? 'claude-haiku-4-5' : 'claude-sonnet-4-6'
  const inTok = PER_PATTERN_IN + OVERHEAD_IN / LEARNING.CHUNK
  const outTok = OUT_PER_CHUNK / LEARNING.CHUNK
  return estimateCost(modelId, inTok, outTok)
}

const FACET_WEIGHT: Record<string, number> = {
  owner_takeover: 3, complaint: 2.5, pricing: 2, booking: 1.5, service_scope: 1.2, hours_location: 0.8, other: 1,
}
// A pattern's learning value: how common it is × how important its topic is. The budget is
// spent on the most valuable patterns first, so a cap can only ever cut low-value tails.
function valueOf(rep: Representative): number {
  return rep.frequency * (FACET_WEIGHT[rep.facet] ?? 1)
}

export function planLearningJob(
  reps: Representative[],
  memory: MemoryEntry[],
  opts: { capUSD: number; phase: LearningPhase },
): LearningPlan {
  const { capUSD } = opts
  const { known, similar, novel } = partitionPatterns(reps, memory)
  const notes: string[] = []

  const strongCost = perPatternCost('strong')
  const cheapCost = perPatternCost('cheap')
  const estimatedIfNaiveUSD = reps.length * strongCost

  if (known.length || similar.length) {
    notes.push(`skip-known: ${known.length} known + ${similar.length} similar patterns reinforced without an LLM (saved ~$${((known.length + similar.length) * strongCost).toFixed(4)})`)
  }

  // Highest-value novel patterns first.
  const ranked = [...novel].sort((a, b) => valueOf(b) - valueOf(a))
  const processNow: PlanItem[] = []
  const deferred: Representative[] = []
  let cost = 0

  // Pass 1: strong model, greedily fit by value.
  for (const rep of ranked) {
    if (cost + strongCost <= capUSD) { processNow.push({ rep, model: 'strong' }); cost += strongCost }
    else deferred.push(rep)
  }

  // Pass 2: if patterns were deferred, try to rescue the most valuable of them by routing
  // to Haiku (cheaper) — "prefer Haiku over Sonnet to stay under the cap".
  if (deferred.length) {
    const rescue: Representative[] = []
    const stillDeferred: Representative[] = []
    let routed = 0
    for (const rep of deferred) {
      if (cost + cheapCost <= capUSD) { processNow.push({ rep, model: 'cheap' }); cost += cheapCost; routed++ }
      else stillDeferred.push(rep)
    }
    deferred.length = 0
    deferred.push(...stillDeferred)
    void rescue
    if (routed) notes.push(`model-routing: ${routed} lower-value novel patterns routed to Haiku to fit under the $${capUSD} cap`)
  }

  if (deferred.length) {
    notes.push(`deferred: ${deferred.length} novel patterns exceed the $${capUSD} cap — will resume in the next job`)
  }
  if (!novel.length) notes.push('nothing novel — business already understood; no LLM spend needed')

  // Savings = everything we did NOT synthesize with the strong model, at the naive price.
  const strongUsed = processNow.filter((p) => p.model === 'strong').length
  const costSavedUSD = estimatedIfNaiveUSD - cost - 0 // (Haiku-routed + deferred + skipped all avoided full strong price)
  void strongUsed

  return {
    known, similar, novel,
    processNow, deferred,
    estimatedCostUSD: Number(cost.toFixed(6)),
    estimatedIfNaiveUSD: Number(estimatedIfNaiveUSD.toFixed(6)),
    costSavedUSD: Number(Math.max(0, costSavedUSD).toFixed(6)),
    willFit: deferred.length === 0,
    samplesConsidered: reps.length,
    notes,
  }
}
