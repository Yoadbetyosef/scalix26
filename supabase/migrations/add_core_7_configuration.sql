-- ============================================================================
-- Scalix Core — Phase 7: Configuration Foundation
-- ============================================================================
-- Additive & non-destructive. Adds terminology_overrides — per-tenant relabeling of SUPPORTED business
-- nouns only (contact/company/estimate/order/…). System actions (Save/Delete/Settings) are NOT in the
-- supported set and can never be overridden. Numbering rules (numbering_counters), custom fields
-- (field_definitions/options) and module config already exist from earlier phases; Phase 7 adds the
-- management surfaces. Real RLS. Idempotent. Run in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS terminology_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  noun_key text NOT NULL,             -- must be a Core-supported business noun (enforced in app)
  singular text, plural text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, noun_key));

ALTER TABLE terminology_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS terminology_overrides_tenant ON terminology_overrides;
CREATE POLICY terminology_overrides_tenant ON terminology_overrides
  FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());
