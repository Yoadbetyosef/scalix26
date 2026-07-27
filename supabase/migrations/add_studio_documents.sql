-- Migration: Studio documents — one lean mechanism behind the 3 product actions
-- (Send to production / Quote / Invoice). Run in the Supabase SQL Editor AFTER
-- add_studio_variants_rich.sql. Idempotent.
--
-- A document is a snapshot: its line_items copy the name/fabric/price AT CREATION time, so editing a
-- product later never changes an already-issued quote/invoice/production order. Each has a public token
-- → a clean, printable page at /d/<token>. No email / no Stripe in v1 (owner shares the link / prints).
-- RLS-locked → only the server (admin client, after auth + tenant resolution) reads/writes.

CREATE TABLE IF NOT EXISTS studio_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id  uuid REFERENCES studio_products(id) ON DELETE SET NULL,
  type        text NOT NULL CHECK (type IN ('production','quote','invoice')),
  token       text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  status      text NOT NULL DEFAULT 'open',
  party_name  text,                                   -- client (quote/invoice) or supplier (production)
  party_email text,
  notes       text,
  currency    text NOT NULL DEFAULT 'usd',
  line_items  jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{ref,name,fabric,sku,qty,unit_price}]
  subtotal    numeric(12,2) NOT NULL DEFAULT 0,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_documents_tenant  ON studio_documents(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_documents_product ON studio_documents(tenant_id, product_id, created_at DESC);

ALTER TABLE studio_documents ENABLE ROW LEVEL SECURITY;

-- ── Reverse (down) ────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS studio_documents CASCADE;
