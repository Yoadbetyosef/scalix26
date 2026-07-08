-- Migration: Growth OS Sprint 1 — modular foundation.
-- Per-partner module gating (mirrors tenants.enabled_modules) + org/brand/billing/upgrade seams
-- (nullable — designed now, engines built later) + expanded partner_type preset list.
-- Backward-compatible: a NULL enabled_modules means ALL modules (existing partners keep everything).
-- Idempotent. Run after add_partner_os_1..11.

-- ── Module gating + growth seams on partners ──
ALTER TABLE partners ADD COLUMN IF NOT EXISTS enabled_modules text[];              -- NULL = all (back-compat)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS organization_id uuid;                -- franchise/enterprise container (seam)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS parent_partner_id uuid REFERENCES partners(id) ON DELETE SET NULL; -- franchise HQ→location
ALTER TABLE partners ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'revenue_share'
  CHECK (billing_mode IN ('revenue_share','reseller'));                            -- the real money fork
ALTER TABLE partners ADD COLUMN IF NOT EXISTS brand_id uuid;                       -- white-label brand (seam)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS upgrade_level text;                  -- last upgrade nudge acted on

CREATE INDEX IF NOT EXISTS idx_partners_org ON partners(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partners_parent ON partners(parent_partner_id) WHERE parent_partner_id IS NOT NULL;

-- ── Expand partner_type to the full Growth OS preset list ──
-- Existing values (affiliate, growth, agency, enterprise, internal_rep) remain valid.
ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_partner_type_check;
ALTER TABLE partners ADD CONSTRAINT partners_partner_type_check CHECK (partner_type IN (
  'affiliate','creator','growth','agency','technology','implementation',
  'industry_expert','franchise','white_label','enterprise','internal_rep'
));
