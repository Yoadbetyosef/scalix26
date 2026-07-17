-- ============================================================================
-- Standalone QuickBooks Online connection (per-tenant OAuth)
-- ============================================================================
-- Depends on migrations 1–7. Run in the Supabase SQL Editor. Idempotent.
-- Stores ONE QuickBooks Online connection per tenant. OAuth tokens are AES-256-GCM
-- encrypted at rest (APP_ENCRYPTION_KEY, via lib/mailbox/crypto.ts) and are never
-- returned to the browser — the UI only ever reads status/company_name/realm_id.

CREATE TABLE IF NOT EXISTS commerce_quickbooks_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  realm_id text NOT NULL,                       -- QBO company id
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','production')),
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  refresh_token_expires_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disconnected','error')),
  company_name text,
  last_error text,
  last_synced_at timestamptz,
  connected_by text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS commerce_qbo_tenant_idx ON commerce_quickbooks_connections (tenant_id);

ALTER TABLE commerce_quickbooks_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_qbo_tenant ON commerce_quickbooks_connections;
CREATE POLICY commerce_qbo_tenant ON commerce_quickbooks_connections
  FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());
