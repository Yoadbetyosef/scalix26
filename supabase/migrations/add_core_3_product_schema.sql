-- ============================================================================
-- Scalix Core — Phase 3: Generic Catalog, Variants, Components & Attribute Engine
-- ============================================================================
-- Additive & non-destructive. catalog_products stays the product spine. Adds:
--   product_variants   — sellable versions (size/material/finish/config); own SKU + price override (cents)
--   product_components — physical pieces/parts of a product or variant (generic, e.g. sofa sections)
--   product_media      — multi-image/asset gallery
--   field_definitions / field_options / field_values — the reusable attribute engine (18 types).
-- Vertical attributes (Furniture fabric/width/…, Jewelry carat/…) live in field_values, NOT in Core
-- columns. Money is integer minor units (cents) + currency. Real RLS on every new table.
-- Run in the Supabase SQL Editor. Idempotent.

-- ── variants (sellable versions) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  name text NOT NULL, sku text,
  price_override_cents bigint, currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','discontinued')),
  track_inventory boolean NOT NULL DEFAULT true,
  image_url text, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (tenant_id, product_id, sort_order);

-- ── components (physical pieces/parts; generic BOM, not sellable versions) ───
CREATE TABLE IF NOT EXISTS product_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,  -- optional: piece of a specific variant
  name text NOT NULL, sku text, image_url text,
  quantity numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),           -- pieces per assembled unit
  price_cents bigint, currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','discontinued')),
  sort_order integer NOT NULL DEFAULT 0,
  qr_code_token text NOT NULL DEFAULT gen_random_uuid()::text,        -- public per-piece page (generalizes the branch "parts" QR)
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_components_product ON product_components (tenant_id, product_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_components_qr ON product_components (qr_code_token);

-- ── media gallery (products + variants) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid REFERENCES catalog_products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  url text NOT NULL, kind text NOT NULL DEFAULT 'image' CHECK (kind IN ('image','video','file')),
  alt text, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_product_media_product ON product_media (tenant_id, product_id, sort_order);

-- ── attribute engine: definitions → options → values (the configurable extension layer) ──
CREATE TABLE IF NOT EXISTS field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,          -- product|variant|component|contact|company|… (which Core entity this extends)
  key text NOT NULL,                  -- stable internal key (e.g. 'fabric', 'width_cm', 'carat')
  label text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN (
    'text','long_text','integer','decimal','money','boolean','date','datetime',
    'select','multi_select','file','image',
    'contact_relation','company_relation','product_relation','variant_relation','user_relation','record_relation')),
  required boolean NOT NULL DEFAULT false,
  default_value jsonb, validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, key));
CREATE INDEX IF NOT EXISTS idx_field_defs_entity ON field_definitions (tenant_id, entity_type, sort_order);

CREATE TABLE IF NOT EXISTS field_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  field_definition_id uuid NOT NULL REFERENCES field_definitions(id) ON DELETE CASCADE,
  value text NOT NULL, label text NOT NULL, sort_order integer NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true,
  UNIQUE (field_definition_id, value));
CREATE INDEX IF NOT EXISTS idx_field_options_def ON field_options (tenant_id, field_definition_id, sort_order);

CREATE TABLE IF NOT EXISTS field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  field_definition_id uuid NOT NULL REFERENCES field_definitions(id) ON DELETE CASCADE,
  record_type text NOT NULL,          -- must match the definition's entity_type
  record_id uuid NOT NULL,
  value jsonb,                        -- typed value; extension data only (never critical money/inventory/identity)
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (field_definition_id, record_id));
CREATE INDEX IF NOT EXISTS idx_field_values_record ON field_values (tenant_id, record_type, record_id);

-- ── RLS on every new table ──────────────────────────────────────────────────
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY['product_variants','product_components','product_media','field_definitions','field_options','field_values']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id())', t||'_tenant', t);
  END LOOP; END $$;
