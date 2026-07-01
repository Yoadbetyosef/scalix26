-- Migration: learning_jobs — one row per learning run (initial import or incremental job),
-- recording the pre-flight ESTIMATE, the ACTUAL cost, and every Cost-Simulator metric so
-- Scalix admins know exactly what each customer costs. Run in the Supabase SQL Editor.
-- The app degrades gracefully if this is missing (per-run guardrails still apply).

CREATE TABLE IF NOT EXISTS learning_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source TEXT NOT NULL,                          -- 'conversations' | 'engine' | future imports
  phase TEXT NOT NULL DEFAULT 'incremental',     -- initial | incremental
  status TEXT NOT NULL DEFAULT 'running',         -- running | completed | paused | error

  -- Per-job hard cost cap (USD). NOT a daily/monthly budget.
  max_cost NUMERIC(10,4) NOT NULL DEFAULT 0,

  -- Deterministic reduction metrics (the cheap pass, before any LLM).
  records_scanned INTEGER NOT NULL DEFAULT 0,
  records_skipped INTEGER NOT NULL DEFAULT 0,        -- already-seen (content cache)
  records_deduplicated INTEGER NOT NULL DEFAULT 0,   -- near-duplicates collapsed away
  samples_selected INTEGER NOT NULL DEFAULT 0,       -- representatives that reached the LLM

  -- Cumulative-memory + planner metrics.
  patterns_known INTEGER NOT NULL DEFAULT 0,         -- already understood → reinforced free (no LLM)
  patterns_similar INTEGER NOT NULL DEFAULT 0,       -- merged into an existing pattern (no LLM)
  patterns_novel INTEGER NOT NULL DEFAULT 0,         -- genuinely new → allowed to reach the LLM
  patterns_deferred INTEGER NOT NULL DEFAULT 0,      -- left for the next job to fit under the cap
  cost_saved NUMERIC(10,6) NOT NULL DEFAULT 0,       -- $ avoided by skip-known / routing / deferral

  -- LLM usage.
  llm_calls INTEGER NOT NULL DEFAULT 0,
  estimated_tokens BIGINT NOT NULL DEFAULT 0,
  actual_tokens BIGINT NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(10,6) NOT NULL DEFAULT 0,   -- from the pre-flight estimator
  actual_cost NUMERIC(10,6) NOT NULL DEFAULT 0,      -- measured after the run

  -- Timing.
  estimated_duration_ms BIGINT NOT NULL DEFAULT 0,
  duration_ms BIGINT NOT NULL DEFAULT 0,

  hard_stopped_reason TEXT,                          -- job_cap | run_calls | run_tokens | deferred | disabled
  optimization_notes JSONB,                          -- the planner's automatic decisions (admin visibility)
  breakdown JSONB,                                   -- per-source counts behind the estimate

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

-- Upgrade-safe: if learning_jobs already exists from an earlier version, add the new columns.
ALTER TABLE learning_jobs
  ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'incremental',
  ADD COLUMN IF NOT EXISTS max_cost NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS patterns_known INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS patterns_similar INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS patterns_novel INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS patterns_deferred INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_saved NUMERIC(10,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(10,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cost NUMERIC(10,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_duration_ms BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_ms BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS optimization_notes JSONB,
  ADD COLUMN IF NOT EXISTS breakdown JSONB,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS learning_jobs_tenant_created_idx ON learning_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS learning_jobs_phase_status_idx ON learning_jobs (phase, status);

ALTER TABLE learning_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant learning_jobs access" ON learning_jobs;
CREATE POLICY "Tenant learning_jobs access" ON learning_jobs
  FOR ALL USING (tenant_id = get_tenant_id());
