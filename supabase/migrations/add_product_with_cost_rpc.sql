-- ============================================================================
-- create_product_with_cost — one product and its cost, in one transaction.
--
-- WHY THIS EXISTS. A product row and a cost row are two writes to two tables. Made as two HTTP calls
-- they cannot be atomic: if the cost write fails after the product insert succeeds, the owner is left
-- with a product whose cost they believe they entered. That state can be made visible and retryable
-- but never impossible — closing the tab at the wrong moment leaves it behind. Inside this function
-- the two inserts share a transaction, so either both land or neither does, and a failed cost write
-- becomes a form that refuses to submit rather than a product missing the number it was created with.
--
-- ── THE ACCESS TRADE, WHICH IS THE THING TO UNDERSTAND BEFORE CHANGING ANYTHING HERE ────────────────
--
-- lib/catalog/costs.ts writes costs through the RLS-SCOPED client on purpose, and says why: a policy
-- nothing ever exercises is decoration. This function is the one exception, and it is called with the
-- ADMIN client. That was a decision, not an oversight.
--
-- The reason SECURITY INVOKER alone cannot rescue it: catalog_products has RLS enabled and NO POLICY
-- at all (add_business_catalog.sql — "only the server, after auth + tenant resolution, touches
-- these"). Called as `authenticated`, the product insert here would simply be denied. Making it work
-- means giving catalog_products an INSERT policy, and the only predicate the database can express is
-- `tenant_id = get_tenant_id()` — which resolves the tenant from auth.uid() and therefore returns the
-- WRONG tenant whenever a White Label operator is working inside a client workspace. The active
-- workspace lives in a cookie the database cannot see. (Same reasoning as add_catalog_ingestion_1.sql.)
--
-- So the trade is: on THIS path, the cost row is protected by the application layer —
-- requireCatalogTenant() for the module gate, canViewCosts for the capability, and a server-resolved
-- p_tenant — instead of by RLS. What makes that acceptable is that nothing is downgraded relative to
-- its neighbour: catalog_products writes are ALREADY admin-client with a server-validated tenant on
-- the very same request, so the cost row now sits under exactly the protection its product always had.
--
-- What has NOT changed: every other cost write — the edit card, variants, applyCurrentMarkup — still
-- goes through the RLS client. The policy on product_costs is exercised constantly. It is absent on
-- one new path, not retired.
--
-- SECURITY INVOKER, deliberately NOT DEFINER: this function holds no privilege of its own. It runs
-- with whatever the caller has, and the caller is the same admin client that already creates products.
-- Making it DEFINER would hand it standing privilege and hide the trade above instead of stating it.
--
-- Run in the Supabase SQL Editor. Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_product_with_cost(
  p_tenant  uuid,
  p_product jsonb,
  p_cost    jsonb DEFAULT NULL,   -- NULL when the owner submitted without a cost — an ordinary state
  p_actor   uuid  DEFAULT NULL
)
RETURNS catalog_products
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_product catalog_products;
  v_markup  numeric;
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'create_product_with_cost: tenant is required';
  END IF;

  -- Mapped generically rather than column by column. The caller has already decided which fields are
  -- acceptable (lib/catalog/sanitize.ts), and enumerating them again here would be a second list free
  -- to drift — catalog_products has since grown `fabric` and `measurements`, and would have silently
  -- dropped both.
  v_product := jsonb_populate_record(NULL::catalog_products, p_product);

  -- Anything the client must not choose. tenant_id especially: it comes from the server's resolution
  -- of the active workspace, never from the payload.
  v_product.id         := gen_random_uuid();
  v_product.tenant_id  := p_tenant;
  v_product.created_at := now();
  v_product.updated_at := now();

  -- jsonb_populate_record yields NULL for an absent key, which would defeat the column defaults and
  -- violate NOT NULL. Restore them explicitly.
  v_product.name                := COALESCE(NULLIF(v_product.name, ''), 'Untitled');
  v_product.status              := COALESCE(v_product.status, 'active');
  v_product.availability_status := COALESCE(v_product.availability_status, 'in_stock');
  v_product.showroom_quantity   := COALESCE(v_product.showroom_quantity, 0);
  v_product.warehouse_quantity  := COALESCE(v_product.warehouse_quantity, 0);
  v_product.storage_quantity    := COALESCE(v_product.storage_quantity, 0);
  v_product.incoming_quantity   := COALESCE(v_product.incoming_quantity, 0);
  v_product.tags                := COALESCE(v_product.tags, '{}');
  v_product.qr_code_token       := COALESCE(NULLIF(v_product.qr_code_token, ''), gen_random_uuid()::text);

  INSERT INTO catalog_products VALUES (v_product.*) RETURNING * INTO v_product;

  -- No cost entered. The product stands on its own — a product without a cost row is a normal state,
  -- and the card shows it as "no cost recorded" exactly as it always has.
  IF p_cost IS NULL OR p_cost = 'null'::jsonb THEN
    RETURN v_product;
  END IF;

  -- Snapshotted from today's tenant default, the same rule saveCost() applies to a brand-new row:
  -- changing the default later must never silently rewrite what a product cost last quarter.
  SELECT COALESCE(cost_markup_percent, 10) INTO v_markup FROM tenants WHERE id = p_tenant;

  -- computed_cost is deliberately absent from this INSERT. It is a GENERATED column; the database
  -- calculates (cost_primary + shipping_cost + tariff_cost) * (1 + markup_percent / 100) and nothing
  -- — not this function, not the service role — may write a number that disagrees with its inputs.
  --
  -- shipping_cost and tariff_cost arrive already split. Tenants on the `landed_cost` module type one
  -- combined figure and splitLanded() divides it client-side, leaving any recorded tariff untouched
  -- so the customs figure survives. Nothing about that changes here.
  INSERT INTO product_costs (
    tenant_id, product_id, variant_id,
    cost_primary, cost_secondary, shipping_cost, tariff_cost,
    markup_percent, updated_at, updated_by
  ) VALUES (
    p_tenant, v_product.id, NULL,
    NULLIF(p_cost->>'costPrimary', '')::numeric,
    NULLIF(p_cost->>'costSecondary', '')::numeric,
    COALESCE(NULLIF(p_cost->>'shippingCost', '')::numeric, 0),
    COALESCE(NULLIF(p_cost->>'tariffCost', '')::numeric, 0),
    COALESCE(v_markup, 10),
    now(),
    p_actor
  );

  -- Any failure above raises and takes the product insert with it. That is the point: the owner sees
  -- the form refuse rather than a product saved without the cost they typed into it.
  RETURN v_product;
END;
$$;

-- Only the server calls this. Nothing client-side may create a product, and certainly not a cost.
REVOKE ALL ON FUNCTION create_product_with_cost(uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- ── Rollback ────────────────────────────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS create_product_with_cost(uuid, jsonb, jsonb, uuid);
--
-- Safe to drop at any time: it creates nothing that outlives a call and holds no state. The route
-- falls back to inserting the product alone, which is the save-then-reveal path that shipped in
-- 6b2320a and still works.
