-- ============================================================================
-- Commerce module — Phase 1a: Catalog (products, options, variants, components, bundles)
-- ============================================================================
-- Tenant-gated generic commerce/catalog module (furniture, kitchens, cabinets, flooring,
-- lighting, appliances, retail…). tenant_id is the org boundary; every table is RLS-scoped
-- (tenant_id = get_tenant_id()) and written only by the server (admin client after auth +
-- tenant + module + permission checks). Run in the Supabase SQL Editor. Idempotent.

-- ── Products (all product types live here; components & bundles are products too) ──────────
CREATE TABLE IF NOT EXISTS commerce_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  internal_name text,
  description   text,
  product_type  text NOT NULL DEFAULT 'simple_product'
                  CHECK (product_type IN ('simple_product','configurable_product','component','bundle','service','custom_item')),
  category      text,
  collection    text,
  brand         text,
  supplier_id   uuid,                          -- FK added in Phase 4 (commerce_suppliers); nullable now
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','active','discontinued','archived')),
  cover_image   text,
  gallery       jsonb NOT NULL DEFAULT '[]'::jsonb,
  sku           text,
  barcode       text,
  dimensions    jsonb,                         -- { length, width, height, unit }
  weight        numeric(12,3),
  cost          numeric(14,2),
  default_price numeric(14,2),
  tax_behavior  text NOT NULL DEFAULT 'taxable' CHECK (tax_behavior IN ('taxable','nontaxable','inherit')),
  lead_time_days integer,
  tags          text[] NOT NULL DEFAULT '{}',
  notes         text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);
-- SKU unique per tenant when present (§18).
CREATE UNIQUE INDEX IF NOT EXISTS commerce_products_sku_uniq ON commerce_products (tenant_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS commerce_products_tenant_status_idx ON commerce_products (tenant_id, status);
CREATE INDEX IF NOT EXISTS commerce_products_tenant_type_idx ON commerce_products (tenant_id, product_type);
CREATE INDEX IF NOT EXISTS commerce_products_tenant_category_idx ON commerce_products (tenant_id, category);

-- ── Flexible product options (NOT hardcoded to fabric/color) ───────────────────────────────
CREATE TABLE IF NOT EXISTS commerce_option_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE,
  name          text NOT NULL,                 -- Fabric | Color | Orientation | Finish | Size | Leg Style | Material | …
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_option_groups_product_idx ON commerce_option_groups (tenant_id, product_id);

CREATE TABLE IF NOT EXISTS commerce_option_values (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  option_group_id uuid NOT NULL REFERENCES commerce_option_groups(id) ON DELETE CASCADE,
  value           text NOT NULL,
  display_order   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_option_values_group_idx ON commerce_option_values (tenant_id, option_group_id);

-- ── Variants = valid combinations of options (each a real inventory-tracked SKU) ───────────
CREATE TABLE IF NOT EXISTS commerce_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE,
  name          text,
  sku           text,
  barcode       text,
  image         text,
  cost          numeric(14,2),
  price         numeric(14,2),
  dimensions    jsonb,
  weight        numeric(12,3),
  lead_time_days integer,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','discontinued','archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_variants_sku_uniq ON commerce_variants (tenant_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS commerce_variants_product_idx ON commerce_variants (tenant_id, product_id);

-- Which option values a variant represents (the "valid combination").
CREATE TABLE IF NOT EXISTS commerce_variant_options (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  variant_id      uuid NOT NULL REFERENCES commerce_variants(id) ON DELETE CASCADE,
  option_group_id uuid NOT NULL REFERENCES commerce_option_groups(id) ON DELETE CASCADE,
  option_value_id uuid NOT NULL REFERENCES commerce_option_values(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_variant_options_uniq ON commerce_variant_options (variant_id, option_group_id);
CREATE INDEX IF NOT EXISTS commerce_variant_options_variant_idx ON commerce_variant_options (tenant_id, variant_id);

-- ── Collection → component links (e.g. a sectional collection's component pieces) ──────────
-- Both parent and component are commerce_products rows (component has product_type='component').
CREATE TABLE IF NOT EXISTS commerce_product_components (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_product_id    uuid NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE,
  component_product_id uuid NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE,
  orientation          text,                   -- left | right | armless | corner | …
  display_order        integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_product_components_uniq ON commerce_product_components (parent_product_id, component_product_id, COALESCE(orientation,''));
CREATE INDEX IF NOT EXISTS commerce_product_components_parent_idx ON commerce_product_components (tenant_id, parent_product_id);

-- ── Bundle composition (a bundle is a commerce_products row with product_type='bundle') ─────
-- Never store composition as free text (§3). Each item references a product or a variant.
CREATE TABLE IF NOT EXISTS commerce_bundle_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bundle_id        uuid NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE,
  item_product_id  uuid REFERENCES commerce_products(id) ON DELETE RESTRICT,
  item_variant_id  uuid REFERENCES commerce_variants(id) ON DELETE RESTRICT,
  quantity         integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  display_order    integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- must reference exactly one of product / variant (valid inventory item, §18)
  CONSTRAINT commerce_bundle_items_ref_chk CHECK ((item_product_id IS NOT NULL) <> (item_variant_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS commerce_bundle_items_bundle_idx ON commerce_bundle_items (tenant_id, bundle_id);

-- ── Activity timeline (per-entity events; mirrors the order_events pattern) ─────────────────
CREATE TABLE IF NOT EXISTS commerce_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type  text NOT NULL,                  -- product | variant | draft | project | order | purchase_order | reservation | inventory | …
  entity_id    uuid,
  type         text NOT NULL,                  -- created | updated | archived | price_changed | …
  actor        text,
  payload      jsonb,                          -- includes before/after for financial & inventory events (§19)
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_events_entity_idx ON commerce_events (tenant_id, entity_type, entity_id, created_at DESC);

-- ── RLS: tenant isolation on every table. Service-role writes; no anon/authenticated policy. ─
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'commerce_products','commerce_option_groups','commerce_option_values','commerce_variants',
    'commerce_variant_options','commerce_product_components','commerce_bundle_items','commerce_events'])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id())', t||'_tenant', t);
  END LOOP;
END $$;
