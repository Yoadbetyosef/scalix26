// ── Learning cost-control policy ─────────────────────────────────────────────────
// Cost lives on the JOB, not the calendar. There are NO daily/monthly AI budgets. Instead
// every learning job carries its own hard cost cap and stops the instant the next LLM call
// would exceed it (pause → resume later). Two phases:
//   • initial     — one-time deep import when the owner first connects. Expensive-once.
//   • incremental — tiny background batches over ONLY new data. Near-zero.

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d)

export type LearningPhase = 'initial' | 'incremental'

export const LEARNING = {
  // Master switches.
  ENABLED: process.env.LEARNING_ENABLED !== 'false', // default ON (dev); 'false' hard-disables all LLM learning
  CRON_ENABLED: process.env.LEARNING_CRON_ENABLED === 'true', // default OFF — cron cannot run until enabled
  LOG: process.env.NODE_ENV !== 'production' || process.env.LEARNING_LOG === 'true',

  // History cap — never look back further than this, no matter the source (point 4).
  HISTORY_MONTHS: num(process.env.LEARNING_HISTORY_MONTHS, 10),

  // Per-JOB hard cost caps (USD). The only budget that exists. A job pauses when the next
  // call would cross its cap; the leftover work resumes in the next job.
  MAX_COST: {
    initial: num(process.env.LEARNING_INITIAL_MAX_COST, 5),
    incremental: num(process.env.LEARNING_INCREMENTAL_MAX_COST, 0.1),
  } as Record<LearningPhase, number>,

  // How much data each phase pulls from the DB (deterministic work, not LLM).
  INITIAL_MAX_RECORDS: num(process.env.LEARNING_INITIAL_MAX_RECORDS, 5000), // cap rows loaded for the one-time import
  INCREMENTAL_BATCH: num(process.env.LEARNING_INCREMENTAL_BATCH, 200), // new records per incremental job

  // How many representative examples ever reach the LLM (after cluster+dedupe+sample).
  SAMPLE: { initial: num(process.env.LEARNING_SAMPLE_INITIAL, 80), incremental: num(process.env.LEARNING_SAMPLE_INCREMENTAL, 15) } as Record<LearningPhase, number>,
  CHUNK: num(process.env.LEARNING_CHUNK, 20), // representatives per synthesis call (batching, point 10)

  MAX_MESSAGES_PER_RUN: num(process.env.LEARNING_MAX_MESSAGES, 3000),

  // Secondary per-run guardrails (backstop even if a cap is misconfigured).
  MAX_LLM_CALLS_PER_RUN: num(process.env.LEARNING_MAX_CALLS_RUN, 12),
  MAX_TOKENS_PER_RUN: num(process.env.LEARNING_MAX_TOKENS_RUN, 400_000),
} as const

export function jobCap(phase: LearningPhase): number { return LEARNING.MAX_COST[phase] }
export function sampleSize(phase: LearningPhase): number { return LEARNING.SAMPLE[phase] }

// ── Model tiers (point 8) ────────────────────────────────────────────────────────
// Cheap model does the high-volume classification/extraction; the stronger model is used
// ONLY for the final business understanding (a handful of calls per import).
export type ModelTier = 'cheap' | 'strong'
export const MODEL_TIERS: Record<ModelTier, string> = {
  cheap: 'claude-haiku-4-5',
  strong: 'claude-sonnet-4-6',
}

// Estimated list price, USD per 1M tokens — used to ESTIMATE spend for the cap gate, the
// pre-flight estimator, and the admin Cost Simulator. Deliberately conservative (rounds up).
export const MODEL_PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1.0, out: 5.0 },
  'claude-sonnet-4-6': { in: 3.0, out: 15.0 },
}

export function historyFloorISO(now = Date.now()): string {
  return new Date(now - LEARNING.HISTORY_MONTHS * 30 * 864e5).toISOString()
}
