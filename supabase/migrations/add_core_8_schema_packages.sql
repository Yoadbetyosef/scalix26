-- ============================================================================
-- Scalix Core — Phase 8A: Vertical Schema Packages (reusable field bundles)
-- ============================================================================
-- Additive & non-destructive. Turns the raw per-tenant attribute engine (field_definitions/
-- options/values from Phase 3) into an installable PACKAGE system so a vertical (Furniture,
-- Jewelry, …) is a reusable bundle of field templates a tenant can INSTALL — not a hand-coded
-- seed script. A Jewelry tenant that installs only the Jewelry package receives ZERO furniture
-- fields. Installs are idempotent; upgrades update definitions in place and NEVER delete tenant
-- field_values (values key off the stable field_definition id, which survives an upsert).
--
--   vertical_schema_packages        — global catalog of installable packages (platform-managed)
--   vertical_schema_package_fields  — the field templates inside a package
--   tenant_schema_installations     — which package+version a tenant has installed
--   field_definitions.source_package_id  — marks a definition as package-provided vs tenant-custom
--
-- Packages/fields are GLOBAL (readable by any tenant, written only by the service role). Installs
-- are tenant-scoped with real RLS. Money stays integer cents; typed Core columns are never moved
-- into fields. Run in a FRESH Supabase SQL Editor tab. Idempotent.

-- ── global package catalog ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vertical_schema_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,             -- stable slug: 'furniture','jewelry',…
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,   -- bump to ship a package upgrade
  description text,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','deprecated')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS vertical_schema_package_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES vertical_schema_packages(id) ON DELETE CASCADE,
  entity_type text NOT NULL,            -- product|variant|component|contact|company|…
  key text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN (
    'text','long_text','integer','decimal','money','boolean','date','datetime',
    'select','multi_select','file','image',
    'contact_relation','company_relation','product_relation','variant_relation','user_relation','record_relation')),
  required boolean NOT NULL DEFAULT false,
  default_value jsonb,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{value,label}] for select/multi_select
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (package_id, entity_type, key));
CREATE INDEX IF NOT EXISTS idx_pkg_fields_pkg ON vertical_schema_package_fields (package_id, entity_type, sort_order);

-- ── per-tenant install record ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_schema_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES vertical_schema_packages(id) ON DELETE CASCADE,
  installed_version integer NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now(),
  installed_by uuid,
  status text NOT NULL DEFAULT 'installed' CHECK (status IN ('installed','uninstalled')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, package_id));
CREATE INDEX IF NOT EXISTS idx_tenant_installs ON tenant_schema_installations (tenant_id, status);

-- ── mark package-provided definitions (NULL = tenant-authored custom field) ──
ALTER TABLE field_definitions
  ADD COLUMN IF NOT EXISTS source_package_id uuid REFERENCES vertical_schema_packages(id) ON DELETE SET NULL;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Global catalog: readable by everyone; writes only via the service role (no write policy).
ALTER TABLE vertical_schema_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vertical_schema_packages_read ON vertical_schema_packages;
CREATE POLICY vertical_schema_packages_read ON vertical_schema_packages FOR SELECT USING (true);

ALTER TABLE vertical_schema_package_fields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vertical_schema_package_fields_read ON vertical_schema_package_fields;
CREATE POLICY vertical_schema_package_fields_read ON vertical_schema_package_fields FOR SELECT USING (true);

-- Installs: tenant-scoped like the rest of Core.
ALTER TABLE tenant_schema_installations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_schema_installations_tenant ON tenant_schema_installations;
CREATE POLICY tenant_schema_installations_tenant ON tenant_schema_installations
  FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- ── seed the package CATALOG (templates only — NOT installed for any tenant) ─
-- Seeding the catalog is safe and is NOT "seeding furniture globally": no tenant receives any
-- field_definition until it explicitly installs a package. Idempotent on (key) / (package,entity,key).
INSERT INTO vertical_schema_packages (key, name, version, description, status) VALUES
  ('furniture', 'Furniture', 1, 'Furniture vertical — fabric & dimensions for products.', 'published'),
  ('jewelry',   'Jewelry',   1, 'Jewelry vertical — carat & metal for products.', 'published')
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status, updated_at = now();

INSERT INTO vertical_schema_package_fields (package_id, entity_type, key, label, field_type, required, options, sort_order)
SELECT p.id, v.entity_type, v.key, v.label, v.field_type, v.required, v.options, v.sort_order
FROM vertical_schema_packages p
JOIN (VALUES
  ('furniture', 'product', 'fabric',    'Fabric',      'select',  false, '[{"value":"velvet","label":"Velvet"},{"value":"leather","label":"Leather"},{"value":"linen","label":"Linen"},{"value":"boucle","label":"Bouclé"}]'::jsonb, 0),
  ('furniture', 'product', 'width_cm',  'Width (cm)',  'decimal', false, '[]'::jsonb, 1),
  ('furniture', 'product', 'height_cm', 'Height (cm)', 'decimal', false, '[]'::jsonb, 2),
  ('furniture', 'product', 'depth_cm',  'Depth (cm)',  'decimal', false, '[]'::jsonb, 3),
  ('jewelry',   'product', 'carat',     'Carat',       'decimal', false, '[]'::jsonb, 0),
  ('jewelry',   'product', 'metal',     'Metal',       'select',  false, '[{"value":"gold","label":"Gold"},{"value":"silver","label":"Silver"},{"value":"platinum","label":"Platinum"}]'::jsonb, 1)
) AS v(pkey, entity_type, key, label, field_type, required, options, sort_order) ON p.key = v.pkey
ON CONFLICT (package_id, entity_type, key) DO UPDATE
  SET label = EXCLUDED.label, field_type = EXCLUDED.field_type, required = EXCLUDED.required,
      options = EXCLUDED.options, sort_order = EXCLUDED.sort_order;
