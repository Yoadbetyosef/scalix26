-- Migration: learning_seen — content cache so the learning system never sends the same
-- message/thread/transcript to the LLM twice (dedupe by content hash). Run in the Supabase
-- SQL Editor. (The app degrades gracefully if missing — it will just re-consider items,
-- still bounded by the per-run budget.)

CREATE TABLE IF NOT EXISTS learning_seen (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  content_hash TEXT NOT NULL,        -- sha256 of the normalized content
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, content_hash)
);

CREATE INDEX IF NOT EXISTS learning_seen_tenant_source_idx ON learning_seen (tenant_id, source);

ALTER TABLE learning_seen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant learning_seen access" ON learning_seen;
CREATE POLICY "Tenant learning_seen access" ON learning_seen
  FOR ALL USING (tenant_id = get_tenant_id());
