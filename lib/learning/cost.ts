import { MODEL_PRICING } from './config'

// Cheap, deterministic token/cost estimation — no tokenizer dependency. ~4 chars/token is
// a conservative English approximation; we round UP so the budget gate errs toward caution.
export function approxTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

// USD cost estimate for one call. Unknown models fall back to the most expensive tier so an
// unrecognized model can never slip past the budget as "free".
export function estimateCost(model: string, inTokens: number, outTokens: number): number {
  const p = MODEL_PRICING[model] || { in: 3, out: 15 }
  return (inTokens / 1_000_000) * p.in + (outTokens / 1_000_000) * p.out
}
