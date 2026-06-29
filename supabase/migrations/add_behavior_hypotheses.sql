-- Migration: behavior_hypotheses — the Owner Behavior Model taking shape in the
-- background. Distilled, evidence-scored patterns of how the business behaves. These do
-- NOT affect customer-facing behavior; only owner-approved suggestions do. Run in the SQL Editor.

CREATE TABLE IF NOT EXISTS behavior_hypotheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,                 -- maps to an OwnerPlaybook section
  facet TEXT,                              -- which focused distillation pass produced it
  statement TEXT NOT NULL,
  evidence_count INT DEFAULT 1,
  consistency NUMERIC DEFAULT 0.5,
  confidence NUMERIC DEFAULT 0.5,
  tier TEXT DEFAULT 'observed',            -- observed | low | medium | high
  gold BOOLEAN DEFAULT false,              -- derived from owner's own action (strongest evidence)
  channels TEXT[] DEFAULT '{}',
  examples JSONB DEFAULT '[]',
  outcome_note TEXT,
  proposed JSONB DEFAULT '{}',
  show_to_owner BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_behavior_hypotheses_scope ON behavior_hypotheses (tenant_id, ai_employee_id, dimension);

ALTER TABLE behavior_hypotheses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant behavior_hypotheses access" ON behavior_hypotheses;
CREATE POLICY "Tenant behavior_hypotheses access" ON behavior_hypotheses
  FOR ALL USING (tenant_id = get_tenant_id());
