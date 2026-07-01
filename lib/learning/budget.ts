import type { SupabaseClient } from '@supabase/supabase-js'
import { LEARNING, MODEL_TIERS, type ModelTier, type LearningPhase } from './config'
import { approxTokens, estimateCost } from './cost'

// ── The per-job cost gate ────────────────────────────────────────────────────────
// One LearningBudget == one learning_jobs row == one hard cost cap. Every learning LLM
// call goes through .call(); before spending it checks the projected cost against THIS
// job's cap (not any daily/monthly total). When the cap (or a secondary run guardrail) is
// hit it makes no call, records the reason, and marks the job paused so the remaining work
// resumes later. It records every Cost-Simulator metric (points 6 & 11).

// 'deferred' is a planned, intentional stop (work left to fit under the cap), not a failure.
export type StopReason = 'disabled' | 'run_calls' | 'run_tokens' | 'job_cap' | 'deferred'

export const BUDGET_PAUSED_MESSAGE = 'Learning paused to protect your plan. More learning will continue later.'

export interface Preflight {
  tokens: number
  costUSD: number
  durationMs: number
  breakdown?: Record<string, unknown>
}

export interface JobMetrics {
  records_scanned: number
  records_skipped: number
  records_deduplicated: number
  samples_selected: number
  patterns_known: number
  patterns_similar: number
  patterns_novel: number
  patterns_deferred: number
  cost_saved: number
  llm_calls: number
  actual_tokens: number
  actual_cost: number
}

interface CallResult { text: string; inTok?: number; outTok?: number }

export class LearningBudget {
  readonly phase: LearningPhase
  readonly maxCostUSD: number
  private preflight?: Preflight
  private m: JobMetrics = { records_scanned: 0, records_skipped: 0, records_deduplicated: 0, samples_selected: 0, patterns_known: 0, patterns_similar: 0, patterns_novel: 0, patterns_deferred: 0, cost_saved: 0, llm_calls: 0, actual_tokens: 0, actual_cost: 0 }
  private notes: string[] = []
  private jobId: string | null = null
  private startedAt = 0
  stopped: StopReason | null = null

  constructor(
    private admin: SupabaseClient,
    private tenantId: string,
    readonly source: string,
    init: { phase: LearningPhase; maxCostUSD: number; preflight?: Preflight },
  ) {
    this.phase = init.phase
    this.maxCostUSD = init.maxCostUSD
    this.preflight = init.preflight
  }

  /** Open the job row. No daily/monthly rollups are loaded — the cap is per job. */
  async begin(): Promise<void> {
    this.startedAt = Date.now()
    if (!LEARNING.ENABLED) { this.stopped = 'disabled'; return }
    try {
      const { data } = await this.admin.from('learning_jobs').insert({
        tenant_id: this.tenantId, source: this.source, phase: this.phase, status: 'running',
        max_cost: this.maxCostUSD,
        estimated_tokens: this.preflight?.tokens ?? 0,
        estimated_cost: this.preflight ? Number(this.preflight.costUSD.toFixed(6)) : 0,
        estimated_duration_ms: this.preflight?.durationMs ?? 0,
        breakdown: this.preflight?.breakdown ?? null,
        started_at: new Date().toISOString(),
      }).select('id').single()
      this.jobId = (data?.id as string) ?? null
    } catch { /* learning_jobs not migrated → per-run guardrails still apply */ }
  }

  scanned(n: number) { this.m.records_scanned += n }
  skipped(n: number) { this.m.records_skipped += n }
  deduplicated(n: number) { this.m.records_deduplicated += n }
  samples(n: number) { this.m.samples_selected += n }
  known(n: number) { this.m.patterns_known += n }
  similar(n: number) { this.m.patterns_similar += n }
  novel(n: number) { this.m.patterns_novel += n }
  deferredCount(n: number) { this.m.patterns_deferred += n }
  saved(usd: number) { this.m.cost_saved += usd }
  addNotes(notes: string[]) { for (const n of notes) this.notes.push(n) }
  /** Intentional stop: work was left to fit under the cap; the job is NOT complete. */
  defer() { this.stopped = this.stopped ?? 'deferred' }
  get paused(): boolean { return this.stopped !== null }
  get metrics(): JobMetrics { return { ...this.m } }

  private preCheck(estCost: number): StopReason | null {
    if (!LEARNING.ENABLED) return 'disabled'
    if (this.m.llm_calls >= LEARNING.MAX_LLM_CALLS_PER_RUN) return 'run_calls'
    if (this.m.actual_tokens >= LEARNING.MAX_TOKENS_PER_RUN) return 'run_tokens'
    if (this.m.actual_cost + estCost > this.maxCostUSD) return 'job_cap'
    return null
  }

  /**
   * Gate one LLM call against this job's cap. Estimates cost from prompt + maxTokens BEFORE
   * calling; if it would exceed the cap (or a guardrail), makes NO call and returns ''.
   * After a successful call it charges ACTUAL token usage when the provider reports it.
   */
  async call(tier: ModelTier, prompt: string, maxTokens: number, run: () => Promise<CallResult>): Promise<string> {
    const model = MODEL_TIERS[tier]
    const estIn = approxTokens(prompt)
    const estCost = estimateCost(model, estIn, maxTokens)
    const stop = this.preCheck(estCost)
    if (stop) { this.stopped = this.stopped ?? stop; return '' }

    try {
      const r = await run()
      const inTok = r.inTok ?? estIn
      const outTok = r.outTok ?? approxTokens(r.text)
      this.m.llm_calls += 1
      this.m.actual_tokens += inTok + outTok
      this.m.actual_cost += estimateCost(model, inTok, outTok)
      return r.text || ''
    } catch {
      this.m.llm_calls += 1
      this.m.actual_tokens += estIn + maxTokens
      this.m.actual_cost += estCost
      return ''
    }
  }

  /** Persist the final job row (actuals + duration) + dev log. */
  async end(status: 'completed' | 'error' = 'completed'): Promise<JobMetrics> {
    const finalStatus = this.stopped ? 'paused' : status
    const durationMs = this.startedAt ? Date.now() - this.startedAt : 0
    if (this.jobId) {
      try {
        await this.admin.from('learning_jobs').update({
          status: finalStatus,
          records_scanned: this.m.records_scanned,
          records_skipped: this.m.records_skipped,
          records_deduplicated: this.m.records_deduplicated,
          samples_selected: this.m.samples_selected,
          patterns_known: this.m.patterns_known,
          patterns_similar: this.m.patterns_similar,
          patterns_novel: this.m.patterns_novel,
          patterns_deferred: this.m.patterns_deferred,
          cost_saved: Number(this.m.cost_saved.toFixed(6)),
          llm_calls: this.m.llm_calls,
          actual_tokens: this.m.actual_tokens,
          actual_cost: Number(this.m.actual_cost.toFixed(6)),
          duration_ms: durationMs,
          hard_stopped_reason: this.stopped,
          optimization_notes: this.notes,
          finished_at: new Date().toISOString(),
        }).eq('id', this.jobId)
      } catch { /* best-effort */ }
    }
    if (LEARNING.LOG) {
      console.log(
        `[learning] tenant=${this.tenantId} ${this.phase}/${this.source} status=${finalStatus} ` +
        `scanned=${this.m.records_scanned} skipped=${this.m.records_skipped} deduped=${this.m.records_deduplicated} ` +
        `samples=${this.m.samples_selected} calls=${this.m.llm_calls} tokens=${this.m.actual_tokens} ` +
        `actual=$${this.m.actual_cost.toFixed(4)}/cap=$${this.maxCostUSD}${this.stopped ? ` stop=${this.stopped}` : ''} ${durationMs}ms`,
      )
    }
    return { ...this.m }
  }
}

// Has this tenant already completed a one-time initial import for this source?
export async function initialImportDone(admin: SupabaseClient, tenantId: string, source: string): Promise<boolean> {
  try {
    const { data } = await admin
      .from('learning_jobs')
      .select('id')
      .eq('tenant_id', tenantId).eq('source', source).eq('phase', 'initial').eq('status', 'completed')
      .limit(1).maybeSingle()
    return !!data
  } catch {
    return false // table missing → treat as not done (first run will be initial)
  }
}
