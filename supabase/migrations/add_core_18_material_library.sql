-- ============================================================================
-- Generic material/finish library (UI label: "Fabrics" for furniture, "Stones"/"Leather"/… for others via
-- terminology overrides). This is a SEPARATE entity from product variants — variants stay sellable product
-- configurations. Internally it is `catalog_materials`; the label is tenant-configurable. V1 = manual status,
-- no purchasing/rolls/warehouse. Additive + idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS catalog_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  image_url text,
  color text,
  composition text,
  martindale text,        -- text in V1 (avoid unit/number complexity)
  width text,
  weight text,
  notes text,
  status text NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','low_stock','out_of_stock','discontinued')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_catalog_materials_tenant ON catalog_materials (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_catalog_materials_name ON catalog_materials (tenant_id, name);
ALTER TABLE catalog_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant catalog_materials access" ON catalog_materials;
CREATE POLICY "Tenant catalog_materials access" ON catalog_materials FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- Which materials a product offers (many-to-many). Only linked materials appear in proposals/orders.
CREATE TABLE IF NOT EXISTS product_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES catalog_materials(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id, material_id));
CREATE INDEX IF NOT EXISTS idx_product_materials_product ON product_materials (tenant_id, product_id);
ALTER TABLE product_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant product_materials access" ON product_materials;
CREATE POLICY "Tenant product_materials access" ON product_materials FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- Orders preserve the chosen material snapshot so fulfillment knows exactly what was selected.
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS fabric jsonb;

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS product_materials, catalog_materials CASCADE;
-- ALTER TABLE order_line_items DROP COLUMN IF EXISTS fabric;
