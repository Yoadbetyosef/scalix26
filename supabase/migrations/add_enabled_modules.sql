-- Migration: per-tenant module entitlements
-- Run this in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- `enabled_modules` is the set of product modules a business has turned on. Platform admins
-- manage it in /admin/modules.
--   • NEW businesses default to the core set: ai_voice, inbox, contacts (the rest are opt-in).
--   • EXISTING businesses (rows that were NULL before this migration) are backfilled to ALL
--     modules so nothing they already had disappears.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS enabled_modules TEXT[];

-- Default for future inserts = core modules only.
ALTER TABLE tenants
  ALTER COLUMN enabled_modules SET DEFAULT ARRAY['ai_voice','inbox','contacts'];

-- Backfill pre-existing rows to the full set (keep everything they had).
UPDATE tenants
  SET enabled_modules = ARRAY['ai_voice','inbox','contacts','inventory','pipeline','scheduling','estimates']
  WHERE enabled_modules IS NULL;
