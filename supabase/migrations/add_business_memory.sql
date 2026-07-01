-- Migration: business_memory — Cumulative Business Memory. One row per distinct behavior
-- pattern the AI has learned, keyed by a deterministic pattern_hash. Recurring patterns
-- STRENGTHEN this row (evidence_count↑, confidence↑, last_seen_at) instead of paying an LLM
-- to rediscover them. Only novel patterns are ever synthesized. Run in the SQL Editor.

CREATE TABLE IF NOT EXISTS business_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  facet TEXT NOT NULL,                       -- coarse topic cluster (pricing, booking, complaint, …)
  dimension TEXT,                            -- playbook section it maps to
  pattern_hash TEXT NOT NULL,               -- deterministic identity of the pattern
  pattern_key TEXT NOT NULL,                -- channel|facet|normalized-question (debug + similarity)
  tokens TEXT[] DEFAULT '{}',               -- normalized token set (fuzzy "similar" matching)
  statement TEXT NOT NULL DEFAULT '',       -- human-readable anchor for the pattern
  channels TEXT[] DEFAULT '{}',
  evidence_count INT NOT NULL DEFAULT 1,    -- how many real conversations support it
  confidence NUMERIC NOT NULL DEFAULT 0.45, -- strengthens deterministically as evidence grows
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_evidence JSONB DEFAULT '{}',
  suggestion_id UUID,                       -- the review-queue suggestion it produced (avoid dupes)
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, pattern_hash)
);

CREATE INDEX IF NOT EXISTS business_memory_scope_idx ON business_memory (tenant_id, ai_employee_id, facet);

ALTER TABLE business_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant business_memory access" ON business_memory;
CREATE POLICY "Tenant business_memory access" ON business_memory
  FOR ALL USING (tenant_id = get_tenant_id());
