-- ============================================================================
-- Scalix Core — Phase 9 UI: Tenant-managed Product Categories (package-seeded)
-- ============================================================================
-- Additive & non-destructive. Category stops being free text and becomes a managed, per-tenant
-- vocabulary that a vertical PACKAGE seeds (Furniture/Jewelry/HVAC each ship their own list — Core
-- knows nothing about sofas/rugs/lamps). catalog_products.category STAYS a text column (the product's
-- category NAME) so every existing reader (AI context, CSV export, legacy /catalog filter) and every
-- existing value keep working — the product form just picks a name from the managed list. Rename
-- propagates to products in app code. Archive hides a category from selection but keeps it on products.
--
--   product_categories                  — the tenant's managed category list (name + optional group)
--   vertical_schema_package_categories  — category templates a package seeds on install
--
-- Real RLS on the tenant table; the package catalog is globally readable. Run in a FRESH SQL Editor tab.

-- ── tenant-managed categories ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  group_label text,                     -- optional heading for grouped dropdowns (e.g. 'Living Room')
  sort_order integer NOT NULL DEFAULT 0,
  archived_at timestamptz,              -- archived = hidden from selection, kept on existing products
  source_package_id uuid REFERENCES vertical_schema_packages(id) ON DELETE SET NULL,  -- NULL = tenant-authored
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name));
CREATE INDEX IF NOT EXISTS idx_product_categories_tenant ON product_categories (tenant_id, archived_at, sort_order);

-- ── category templates per package ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vertical_schema_package_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES vertical_schema_packages(id) ON DELETE CASCADE,
  group_label text,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (package_id, name));
CREATE INDEX IF NOT EXISTS idx_pkg_categories ON vertical_schema_package_categories (package_id, sort_order);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_categories_tenant ON product_categories;
CREATE POLICY product_categories_tenant ON product_categories
  FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

ALTER TABLE vertical_schema_package_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vertical_schema_package_categories_read ON vertical_schema_package_categories;
CREATE POLICY vertical_schema_package_categories_read ON vertical_schema_package_categories FOR SELECT USING (true);

-- ── seed the FURNITURE package's default categories (templates only; NOT installed for any tenant) ──
INSERT INTO vertical_schema_package_categories (package_id, group_label, name, sort_order)
SELECT p.id, v.group_label, v.name, v.sort_order
FROM vertical_schema_packages p
JOIN (VALUES
  ('Living Room', 'Sofas & Sectionals', 0),
  ('Living Room', 'Accent Chairs', 1),
  ('Living Room', 'Coffee Tables', 2),
  ('Living Room', 'Side Tables', 3),
  ('Living Room', 'Ottomans & Stools', 4),
  ('Dining', 'Dining Tables', 5),
  ('Dining', 'Dining Chairs', 6),
  ('Dining', 'Bar & Counter Stools', 7),
  ('Bedroom', 'Beds', 8),
  ('Lighting', 'Ceiling Lighting', 9),
  ('Lighting', 'Floor Lamps', 10),
  ('Lighting', 'Table Lamps', 11),
  ('Decor', 'Mirrors', 12),
  ('Decor', 'Wall Art', 13),
  ('Decor', 'Pillows', 14),
  ('Decor', 'Decorative Accents', 15),
  ('Decor', 'Planters', 16),
  ('Decor', 'Home Accessories', 17),
  ('Decor', 'Rugs', 18),
  ('Decor', 'Curtains', 19)
) AS v(group_label, name, sort_order) ON p.key = 'furniture'
ON CONFLICT (package_id, name) DO UPDATE SET group_label = EXCLUDED.group_label, sort_order = EXCLUDED.sort_order;
