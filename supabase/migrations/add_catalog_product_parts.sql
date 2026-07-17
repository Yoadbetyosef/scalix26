-- ============================================================================
-- Catalog: product parts/pieces (e.g. the 8–9 pieces of a sofa)
-- ============================================================================
-- Each part belongs to a catalog_products row and has its own photo, price,
-- availability, and QR token. Scanning a part's QR opens a PUBLIC info page at
-- /q/<qr_code_token>. Access mirrors the rest of the catalog: server-only via the
-- admin (service-role) client — RLS is enabled with NO policy so anon/authenticated
-- cannot read the table directly; the app and the public scan page both go through
-- the server. Run in the Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS catalog_product_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  name text NOT NULL,
  image_url text,
  price numeric(12,2),
  availability_status text NOT NULL DEFAULT 'in_stock'
    CHECK (availability_status IN ('in_stock','out_of_stock','incoming','special_order')),
  quantity integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  qr_code_token text NOT NULL DEFAULT gen_random_uuid()::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_parts_product ON catalog_product_parts (tenant_id, product_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_parts_qr ON catalog_product_parts (qr_code_token);

ALTER TABLE catalog_product_parts ENABLE ROW LEVEL SECURITY; -- server (service-role) only; no anon/authenticated policy
