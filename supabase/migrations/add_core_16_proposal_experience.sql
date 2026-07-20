-- ============================================================================
-- Proposal experience completion: preview token, per-proposal template, a rich activity timeline, and
-- tenant-level proposal branding. Additive + idempotent. Extends the existing proposals model — no new
-- sales system, no duplicate contact/image storage.
-- ============================================================================

-- Owner-visible public token (plaintext) so the builder can show/copy the exact customer link and Preview
-- can open the real public URL. public_token_hash stays for hashed lookup + revocation. Per-proposal template.
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS public_token text,
  ADD COLUMN IF NOT EXISTS template text NOT NULL DEFAULT 'clean',
  ADD COLUMN IF NOT EXISTS last_emailed_to text,
  ADD COLUMN IF NOT EXISTS updated_after_send_at timestamptz;
CREATE INDEX IF NOT EXISTS proposals_public_token_plain ON proposals (public_token) WHERE public_token IS NOT NULL;

-- Rich activity timeline (beyond document_status_history). Never exposed on the public page.
CREATE TABLE IF NOT EXISTS proposal_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL,
  event_type text NOT NULL,   -- created|customer_changed|item_added|item_edited|item_removed|previewed|email_attempted|email_sent|email_failed|viewed|accepted|declined|expired|updated_after_send|converted_invoice|converted_order|archived|duplicated
  actor uuid,                 -- null = customer / system
  message text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_proposal_activity ON proposal_activity (tenant_id, proposal_id, created_at DESC);
ALTER TABLE proposal_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant proposal_activity access" ON proposal_activity;
CREATE POLICY "Tenant proposal_activity access" ON proposal_activity FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- Tenant proposal branding (one row per tenant). business_name/logo etc. override the tenant defaults on the
-- public proposal + email. NULLs fall back to the tenants row.
CREATE TABLE IF NOT EXISTS proposal_branding (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  logo_url text,
  business_name text,
  address text,
  phone text,
  email text,
  website text,
  accent_color text NOT NULL DEFAULT '#5b6cf0',
  header_style text NOT NULL DEFAULT 'standard',   -- standard|centered|band
  footer_text text,
  intro text,                                       -- default customer-facing introduction
  default_terms text,
  default_email_subject text,
  default_email_message text,
  updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE proposal_branding ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant proposal_branding access" ON proposal_branding;
CREATE POLICY "Tenant proposal_branding access" ON proposal_branding FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS proposal_activity, proposal_branding CASCADE;
-- ALTER TABLE proposals DROP COLUMN IF EXISTS public_token, DROP COLUMN IF EXISTS template,
--   DROP COLUMN IF EXISTS last_emailed_to, DROP COLUMN IF EXISTS updated_after_send_at;
