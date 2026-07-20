-- ============================================================================
-- Proposal title + rich custom content (scope + custom sections), and provider-aware invoice conversion
-- (Scalix internal / QuickBooks sync / Stripe payment link). Additive + idempotent.
--
-- The Core `invoices` row is ALWAYS the internal record (audit trail + idempotency); provider columns track
-- an external sync (QuickBooks) or an attached payment link (Stripe). The proposal number stays the legal
-- identifier; `title` is a separate, editable, non-unique label.
-- ============================================================================

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS title text,   -- editable customer-facing label; number stays the identifier
  ADD COLUMN IF NOT EXISTS scope text;   -- "Scope / description" section (customer-facing), shown after intro

-- Custom, reorderable, show/hideable proposal sections (Project overview, Delivery, Warranty, …).
CREATE TABLE IF NOT EXISTS proposal_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  visible boolean NOT NULL DEFAULT true,   -- show/hide on the customer proposal
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_proposal_sections ON proposal_sections (tenant_id, proposal_id, sort_order);
ALTER TABLE proposal_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant proposal_sections access" ON proposal_sections;
CREATE POLICY "Tenant proposal_sections access" ON proposal_sections FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- Invoice provider references. provider = scalix|quickbooks|stripe; sync_status = none|pending|synced|failed.
-- external_id = QuickBooks invoice id; external_url = QB invoice link OR Stripe payment-link URL.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'scalix',
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_url text,
  ADD COLUMN IF NOT EXISTS provider_customer_id text,
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS provider_synced_at timestamptz;

-- Tenant commerce settings: default invoice provider + invoice defaults. One row per tenant. Provider config
-- lives here (NOT on the proposal).
CREATE TABLE IF NOT EXISTS commerce_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now());
-- Add each column explicitly so this works whether commerce_settings is new OR already existed (CREATE TABLE
-- IF NOT EXISTS is a no-op on an existing table and would skip new columns).
ALTER TABLE commerce_settings
  ADD COLUMN IF NOT EXISTS default_invoice_provider text NOT NULL DEFAULT 'scalix',
  ADD COLUMN IF NOT EXISTS invoice_send_by_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_payment_terms_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS default_tax_behavior text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS default_invoice_email_message text;
ALTER TABLE commerce_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant commerce_settings access" ON commerce_settings;
CREATE POLICY "Tenant commerce_settings access" ON commerce_settings FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS proposal_sections, commerce_settings CASCADE;
-- ALTER TABLE proposals DROP COLUMN IF EXISTS title, DROP COLUMN IF EXISTS scope;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS provider, DROP COLUMN IF EXISTS sync_status, DROP COLUMN IF EXISTS external_id,
--   DROP COLUMN IF EXISTS external_url, DROP COLUMN IF EXISTS provider_customer_id, DROP COLUMN IF EXISTS sync_error, DROP COLUMN IF EXISTS provider_synced_at;
