-- ============================================================================
-- FIX: create_product_with_cost after add_tg_production_1 PART 4
--
-- Part 4 added two NOT NULL columns with defaults to catalog_products
-- (ownership, on_memo_quantity). This function builds the row with
-- jsonb_populate_record, which yields NULL for absent keys, so EVERY product
-- create failed with a NOT NULL violation until these two COALESCEs were added.
-- APPLIED to production 2026-11-07 (smoke-business-path 97/97 after).
--
-- Rule for the future: any NOT NULL column added to catalog_products must also
-- get a COALESCE line in this function.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_product_with_cost(p_tenant uuid, p_product jsonb, p_cost jsonb DEFAULT NULL::jsonb, p_actor uuid DEFAULT NULL::uuid)
 RETURNS catalog_products
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product catalog_products;
  v_markup  numeric;
  v_comm    numeric;   -- NEW: the tenant's default supplier commission
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
  -- add_tg_production_1 part 4: NOT NULL columns with defaults must be restored here too.
  v_product.ownership           := COALESCE(v_product.ownership, 'owned');
  v_product.on_memo_quantity    := COALESCE(v_product.on_memo_quantity, 0);

  INSERT INTO catalog_products VALUES (v_product.*) RETURNING * INTO v_product;

  -- No cost entered. The product stands on its own — a product without a cost row is a normal state,
  -- and the card shows it as "no cost recorded" exactly as it always has.
  IF p_cost IS NULL OR p_cost = 'null'::jsonb THEN
    RETURN v_product;
  END IF;

  -- Snapshotted from today's tenant default, the same rule saveCost() applies to a brand-new row:
  -- changing the default later must never silently rewrite what a product cost last quarter.
  SELECT COALESCE(cost_markup_percent, 10), COALESCE(cost_commission_percent, 0)   -- NEW: commission
    INTO v_markup, v_comm
    FROM tenants WHERE id = p_tenant;

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
    markup_percent, commission_percent, updated_at, updated_by                      -- NEW column
  ) VALUES (
    p_tenant, v_product.id, NULL,
    NULLIF(p_cost->>'costPrimary', '')::numeric,
    NULLIF(p_cost->>'costSecondary', '')::numeric,
    COALESCE(NULLIF(p_cost->>'shippingCost', '')::numeric, 0),
    COALESCE(NULLIF(p_cost->>'tariffCost', '')::numeric, 0),
    COALESCE(v_markup, 10),
    COALESCE(v_comm, 0),                                                            -- NEW value
    now(), p_actor
  );

  RETURN v_product;
END;
$function$
;
