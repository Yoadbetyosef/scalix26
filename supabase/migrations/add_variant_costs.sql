-- ============================================================================
-- Product cost & margin — Phase 2: a cost row may describe a sub-product too.
--
-- A sub-product has its own selling price (Cavalo WB1 sells for $3,500 against the Cavalo's $8,000),
-- so it needs its own cost: the same sofa in a more expensive fabric costs more to buy.
--
-- Two nullable foreign keys with a CHECK, rather than a polymorphic entity_type/entity_id pair. A
-- polymorphic column cannot carry a foreign key to two tables at once, which means deleting a variant
-- would silently strand its cost row and the cascade would have to move into application code. Here both
-- columns are real FKs, so both cascade, and "points at both" and "points at neither" are unrepresentable
-- rather than merely discouraged.
--
-- The composite keys close a hole that already existed on product_id and was covered only by a check in
-- application code: nothing at the database level stopped a row claiming one tenant while pointing at
-- another tenant's product. Referencing (id, tenant_id) makes a cross-tenant reference impossible to
-- write at all. MATCH SIMPLE (the default) means the constraint is skipped when the id is NULL, which is
-- exactly the behaviour needed for a column that is null on half the rows.
--
-- Additive and idempotent. The one existing row (Albero, computed_cost 1452) keeps product_id set and
-- variant_id null, satisfies the CHECK, and its (product_id, tenant_id) pair already matches
-- catalog_products — verified before writing this.
-- ============================================================================

-- ── Composite targets ───────────────────────────────────────────────────────────────────────────────
-- Trivially unique, since `id` is already the primary key of each table; they exist only so the
-- composite foreign keys below have something to reference.

ALTER TABLE catalog_products ADD CONSTRAINT catalog_products_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE studio_variants  ADD CONSTRAINT studio_variants_id_tenant_key  UNIQUE (id, tenant_id);

-- ── The new column ──────────────────────────────────────────────────────────────────────────────────

ALTER TABLE product_costs ADD COLUMN IF NOT EXISTS variant_id uuid;

-- ── Replace the single-column constraints ───────────────────────────────────────────────────────────
-- Constraint names are discovered rather than assumed: the originals were created inline
-- (`product_id uuid NOT NULL UNIQUE REFERENCES …`), so their generated names are Postgres's business,
-- not ours, and hardcoding a guess would make this migration fail on a differently-named database.

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname, con.contype
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'product_costs'
      AND con.contype IN ('u', 'f')                                    -- unique + foreign key
      AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = rel.oid AND attname = 'product_id')]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE product_costs DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE product_costs ALTER COLUMN product_id DROP NOT NULL;

-- Exactly one target. Written as an inequality of two NULL tests, which is true only when the two
-- differ — i.e. precisely one is set.
ALTER TABLE product_costs DROP CONSTRAINT IF EXISTS product_costs_one_target;
ALTER TABLE product_costs ADD CONSTRAINT product_costs_one_target
  CHECK ((product_id IS NULL) <> (variant_id IS NULL));

-- One cost row per product and per variant. Partial, because a UNIQUE over a nullable column would
-- otherwise allow unlimited rows on the null side in some engines and reads confusingly here.
CREATE UNIQUE INDEX IF NOT EXISTS product_costs_product_uidx ON product_costs (product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_costs_variant_uidx ON product_costs (variant_id) WHERE variant_id IS NOT NULL;

-- ── Tenant-safe foreign keys ────────────────────────────────────────────────────────────────────────

ALTER TABLE product_costs DROP CONSTRAINT IF EXISTS product_costs_product_tenant_fkey;
ALTER TABLE product_costs ADD CONSTRAINT product_costs_product_tenant_fkey
  FOREIGN KEY (product_id, tenant_id) REFERENCES catalog_products (id, tenant_id) ON DELETE CASCADE;

ALTER TABLE product_costs DROP CONSTRAINT IF EXISTS product_costs_variant_tenant_fkey;
ALTER TABLE product_costs ADD CONSTRAINT product_costs_variant_tenant_fkey
  FOREIGN KEY (variant_id, tenant_id) REFERENCES studio_variants (id, tenant_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS product_costs_variant_idx ON product_costs (variant_id) WHERE variant_id IS NOT NULL;

-- RLS is unchanged: the existing policy scopes by product_costs.tenant_id and never looks at what the
-- row points to, so isolation holds identically for a variant row. The canViewCosts limitation
-- documented in add_product_costs.sql is likewise unchanged.

-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE product_costs DROP CONSTRAINT IF EXISTS product_costs_variant_tenant_fkey,
--   DROP CONSTRAINT IF EXISTS product_costs_product_tenant_fkey,
--   DROP CONSTRAINT IF EXISTS product_costs_one_target;
-- DROP INDEX IF EXISTS product_costs_variant_uidx, product_costs_product_uidx, product_costs_variant_idx;
-- ALTER TABLE product_costs DROP COLUMN IF EXISTS variant_id;
-- ALTER TABLE catalog_products DROP CONSTRAINT IF EXISTS catalog_products_id_tenant_key;
-- ALTER TABLE studio_variants  DROP CONSTRAINT IF EXISTS studio_variants_id_tenant_key;
