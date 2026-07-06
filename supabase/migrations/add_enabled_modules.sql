-- Migration: per-tenant module entitlements
-- Run this in the Supabase SQL Editor for existing databases.
--
-- Adds `enabled_modules` to tenants: the set of product modules a business has turned on.
-- Platform admins manage this in /admin/modules. Default = ALL modules, so existing
-- businesses keep every feature they had before this migration.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS enabled_modules TEXT[]
  DEFAULT ARRAY['ai_voice','inbox','contacts','inventory','pipeline','scheduling','estimates'];

-- Backfill any pre-existing rows that came in as NULL.
UPDATE tenants
  SET enabled_modules = ARRAY['ai_voice','inbox','contacts','inventory','pipeline','scheduling','estimates']
  WHERE enabled_modules IS NULL;
