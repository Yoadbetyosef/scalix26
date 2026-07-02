-- Migration: brain_updates — a log of what the Business Brain LEARNED between studies, so
-- the COO can show "What changed today". Written by the run route (deterministic diff of
-- before/after snapshots); the detection engine + Business Confidence are untouched.

CREATE TABLE IF NOT EXISTS brain_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- new_understanding | confidence_up | dna_up
  dna_strand TEXT,
  title TEXT NOT NULL,
  detail TEXT,
  delta INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS brain_updates_scope_idx ON brain_updates (tenant_id, ai_employee_id, created_at DESC);

ALTER TABLE brain_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant brain_updates access" ON brain_updates;
CREATE POLICY "Tenant brain_updates access" ON brain_updates FOR ALL USING (tenant_id = get_tenant_id());
