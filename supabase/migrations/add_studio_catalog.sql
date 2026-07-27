-- Migration: Design Studio catalog v1 (lean, per-tenant). Gated by the `studio` module.
-- Run in the Supabase SQL Editor (project bphpnlgjlklgwhewsnrm). Idempotent.
--
-- A deliberately LEAN alternative to catalog_products (which is inventory/stock oriented):
-- a product is a design; sub-products are variants (size/material/colour). Each product and
-- each variant has a public QR token that opens a public product page (/p/<token>). The
-- supplier + one-tap production/quote/invoice actions layer on top in a later phase.
-- All tables RLS-locked → only the server (admin client, after auth + tenant resolution) reads/writes.

CREATE TABLE IF NOT EXISTS studio_products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           text NOT NULL,
  category       text,                                   -- collection / line
  description    text,                                   -- details / spec, free text
  specs          jsonb NOT NULL DEFAULT '{}'::jsonb,      -- optional structured key→value spec
  base_price     numeric(12,2),
  photos         text[] NOT NULL DEFAULT '{}',            -- image URLs, first = cover
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','archived')),
  supplier_name  text,                                    -- used by "send to production" later
  supplier_email text,
  internal_notes text,
  qr_token       text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_products_tenant   ON studio_products(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_products_category ON studio_products(tenant_id, category);

CREATE TABLE IF NOT EXISTS studio_variants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES studio_products(id) ON DELETE CASCADE,
  label       text NOT NULL,                              -- e.g. "Large / Walnut"
  attributes  jsonb NOT NULL DEFAULT '{}'::jsonb,         -- e.g. {"size":"L","material":"Walnut","color":"Natural"}
  sku         text,
  price       numeric(12,2),                              -- NULL → falls back to product.base_price
  position    integer NOT NULL DEFAULT 0,                 -- display order
  qr_token    text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_variants_product ON studio_variants(tenant_id, product_id, position);

ALTER TABLE studio_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_variants ENABLE ROW LEVEL SECURITY;

-- ── Reverse (down) ────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS studio_variants, studio_products CASCADE;
