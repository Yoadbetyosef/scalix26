-- Migration: business_signals — the Signal Bus / append-only ledger of structured
-- business intelligence emitted from interactions the channels already persist.
-- Observation only; touches no live behavior. Run in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS business_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  channel TEXT,
  conversation_id UUID,
  subject_ref JSONB DEFAULT '{}',
  payload JSONB DEFAULT '{}',
  evidence TEXT,
  sentiment TEXT,
  confidence NUMERIC DEFAULT 0.7,
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_signals_scope ON business_signals (tenant_id, type, occurred_at);

ALTER TABLE business_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant business_signals access" ON business_signals;
CREATE POLICY "Tenant business_signals access" ON business_signals
  FOR ALL USING (tenant_id = get_tenant_id());
