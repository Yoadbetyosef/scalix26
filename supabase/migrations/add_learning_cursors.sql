-- Migration: learning_cursors — per-tenant watermark so the learning engine processes
-- only new activity each run (incremental + idempotent). Run in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS learning_cursors (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  last_processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tenant_id, source)
);

ALTER TABLE learning_cursors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant learning_cursors access" ON learning_cursors;
CREATE POLICY "Tenant learning_cursors access" ON learning_cursors
  FOR ALL USING (tenant_id = get_tenant_id());
