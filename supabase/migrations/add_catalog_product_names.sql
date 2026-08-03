-- ============================================================================
-- Catalog — the tenant's own product-name list, for the Add Product form.
--
-- Your Design Collective works from a fixed range: 241 named pieces across sofas, sectionals, chairs,
-- tables, stools, beds and decor. Typing each name by hand every time invites typos, and a typo means the
-- same piece exists twice in the catalog under two spellings. The Name field becomes a suggest-as-you-type
-- list drawn from this table, and picking a name fills in its category too.
--
-- Nothing here is specific to furniture: it is a per-tenant list of names with an optional category, so a
-- jeweller or a locksmith gets the same behaviour from their own list.
--
-- Additive, idempotent. Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS catalog_product_names (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        text NOT NULL,
  category    text,                              -- prefilled into the form when this name is chosen
  active      boolean NOT NULL DEFAULT true,     -- retire a discontinued piece without losing its history
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness per tenant: "Athena Sofa" and "athena sofa" are the same piece, and the
-- whole point is to stop the catalog holding both.
CREATE UNIQUE INDEX IF NOT EXISTS catalog_product_names_tenant_name_idx
  ON catalog_product_names (tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS catalog_product_names_tenant_active_idx
  ON catalog_product_names (tenant_id, active, category);

ALTER TABLE catalog_product_names ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant catalog_product_names access" ON catalog_product_names;
CREATE POLICY "Tenant catalog_product_names access" ON catalog_product_names
  FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- No seed here on purpose. The list is per-tenant data, loaded from the tenant's own spreadsheet rather
-- than baked into a migration that would otherwise hand one tenant's range to every other.

-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS catalog_product_names CASCADE;
