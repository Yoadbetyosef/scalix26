-- Migration: Business Catalog v1 (lightweight, per-tenant product catalog)
-- Run in the Supabase SQL Editor. Gated by the `inventory` module.

CREATE TABLE IF NOT EXISTS catalog_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text,
  category text,
  brand text,
  description text,
  price numeric(12,2),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','discontinued')),
  availability_status text NOT NULL DEFAULT 'in_stock'
    CHECK (availability_status IN ('in_stock','out_of_stock','incoming','special_order')),
  showroom_quantity integer NOT NULL DEFAULT 0,
  warehouse_quantity integer NOT NULL DEFAULT 0,
  storage_quantity integer NOT NULL DEFAULT 0,
  incoming_quantity integer NOT NULL DEFAULT 0,
  expected_arrival_date date,
  location_notes text,
  tags text[] NOT NULL DEFAULT '{}',
  internal_notes text,
  ai_notes text,
  image_url text,
  qr_code_token text NOT NULL DEFAULT gen_random_uuid()::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_products_tenant ON catalog_products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_catalog_products_sku ON catalog_products(tenant_id, sku);
CREATE INDEX IF NOT EXISTS idx_catalog_products_category ON catalog_products(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_catalog_products_availability ON catalog_products(tenant_id, availability_status);

CREATE TABLE IF NOT EXISTS catalog_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('receive','move','sell','adjust','return')),
  quantity integer NOT NULL DEFAULT 0,
  from_location text,
  to_location text,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_movements_product ON catalog_movements(tenant_id, product_id, created_at DESC);

-- Locked down: only the server (admin client, after auth + tenant resolution) touches these.
ALTER TABLE catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_movements ENABLE ROW LEVEL SECURITY;
