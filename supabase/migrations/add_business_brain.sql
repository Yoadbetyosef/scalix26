-- Migration: Business Brain (Phase 1) — turns existing Scalix data into Business
-- Understanding. Deterministic only; no LLM, no cron. Chain: signals → patterns →
-- understanding (Business DNA) → recommendations. Everything tenant-scoped + idempotent.
-- Run in the Supabase SQL editor. Touches nothing else.

-- 1) Patterns — deterministic facts found in real data.
CREATE TABLE IF NOT EXISTS business_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  category TEXT NOT NULL,                 -- response_time | questions | booking | payment | missed_opportunity | channel
  pattern_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metric_value NUMERIC,
  metric_unit TEXT,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  evidence_refs JSONB DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, ai_employee_id, pattern_key)
);

-- 2) Understanding — what the AI understands, organized by Business DNA strand. Cumulative.
CREATE TABLE IF NOT EXISTS business_understanding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  dna_strand TEXT NOT NULL,               -- sales | pricing | communication | customer | operations
  understanding_key TEXT NOT NULL,
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  source_pattern_ids UUID[] DEFAULT '{}',
  business_confidence INTEGER NOT NULL DEFAULT 0,   -- 0..100, deterministic (NOT model confidence)
  evidence_strength TEXT,                 -- Low | Medium | High | Very High
  evidence_summary TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, ai_employee_id, understanding_key)
);

-- 3) Recommendations — owner-facing, always linked to an understanding.
CREATE TABLE IF NOT EXISTS business_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  understanding_id UUID REFERENCES business_understanding(id) ON DELETE CASCADE,
  category TEXT,
  title TEXT NOT NULL,
  why TEXT,
  how TEXT,
  if_ignored TEXT,
  estimated_impact TEXT,
  business_confidence INTEGER NOT NULL DEFAULT 0,
  evidence_strength TEXT,
  status TEXT NOT NULL DEFAULT 'new',      -- new | seen | acted | dismissed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (understanding_id)
);

-- 4) DNA rollup — per-strand strength for the "strengthen your X DNA" story.
CREATE TABLE IF NOT EXISTS business_dna (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  dna_strand TEXT NOT NULL,
  strength INTEGER NOT NULL DEFAULT 0,     -- 0..100
  evidence_count INTEGER NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, ai_employee_id, dna_strand)
);

CREATE INDEX IF NOT EXISTS business_patterns_scope_idx ON business_patterns (tenant_id, ai_employee_id, category);
CREATE INDEX IF NOT EXISTS business_understanding_scope_idx ON business_understanding (tenant_id, ai_employee_id, dna_strand);
CREATE INDEX IF NOT EXISTS business_recommendations_scope_idx ON business_recommendations (tenant_id, ai_employee_id, status);

ALTER TABLE business_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_understanding ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_dna ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant business_patterns access" ON business_patterns;
DROP POLICY IF EXISTS "Tenant business_understanding access" ON business_understanding;
DROP POLICY IF EXISTS "Tenant business_recommendations access" ON business_recommendations;
DROP POLICY IF EXISTS "Tenant business_dna access" ON business_dna;
CREATE POLICY "Tenant business_patterns access" ON business_patterns FOR ALL USING (tenant_id = get_tenant_id());
CREATE POLICY "Tenant business_understanding access" ON business_understanding FOR ALL USING (tenant_id = get_tenant_id());
CREATE POLICY "Tenant business_recommendations access" ON business_recommendations FOR ALL USING (tenant_id = get_tenant_id());
CREATE POLICY "Tenant business_dna access" ON business_dna FOR ALL USING (tenant_id = get_tenant_id());
