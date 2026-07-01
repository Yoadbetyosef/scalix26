-- Migration: Stripe Connect — tenants connect THEIR OWN Stripe account (Standard/OAuth) so
-- the AI can send secure payment links; money goes directly to the tenant, we never hold
-- funds. Adds the connected-account columns on tenants + the payments ledger the Connect
-- webhook marks paid. Run in the Supabase SQL editor. Platform billing is untouched.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_connect_status TEXT;

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connected_account_id TEXT,
  checkout_session_id TEXT UNIQUE,
  payment_intent_id TEXT,
  price_id TEXT,
  product_name TEXT,
  amount INTEGER,               -- minor units (cents), nullable for variable prices
  currency TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  conversation_id TEXT,
  contact_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | paid
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payments_tenant_idx ON payments (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_session_idx ON payments (checkout_session_id);
CREATE INDEX IF NOT EXISTS payments_pi_idx ON payments (payment_intent_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant payments access" ON payments;
CREATE POLICY "Tenant payments access" ON payments FOR ALL USING (tenant_id = get_tenant_id());
