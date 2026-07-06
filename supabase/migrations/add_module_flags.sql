-- Migration: global module feature-flags (Disabled / Enabled / Beta / Enterprise Only)
-- Run in the Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS module_flags (
  module text PRIMARY KEY,
  state text NOT NULL DEFAULT 'enabled' CHECK (state IN ('disabled','enabled','beta','enterprise')),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed all 12 modules as 'enabled' (no behaviour change until an admin flips one).
INSERT INTO module_flags (module, state) VALUES
  ('ai_voice','enabled'), ('inbox','enabled'), ('contacts','enabled'), ('inventory','enabled'),
  ('pipeline','enabled'), ('scheduling','enabled'), ('estimates','enabled'), ('invoices','enabled'),
  ('payments','enabled'), ('analytics','enabled'), ('business_brain','enabled'), ('knowledge_base','enabled')
ON CONFLICT (module) DO NOTHING;

-- Readable by any authenticated user (the sidebar reads it to gate nav); writable only by the
-- service role (admin API). Enable RLS + a permissive SELECT policy.
ALTER TABLE module_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS module_flags_read ON module_flags;
CREATE POLICY module_flags_read ON module_flags FOR SELECT USING (true);

-- Existing businesses already had Analytics, Business Brain and Knowledge Base as capabilities,
-- so add those keys to their enabled_modules (preserving all their other on/off choices). New
-- billing modules (invoices, payments) stay opt-in.
UPDATE tenants
SET enabled_modules = ARRAY(
  SELECT DISTINCT unnest(enabled_modules || ARRAY['analytics','business_brain','knowledge_base'])
)
WHERE enabled_modules IS NOT NULL;
