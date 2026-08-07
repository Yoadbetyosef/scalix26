-- ============================================================================
-- Supplier commission on the goods.
--
-- The formula gains a third term:
--
--   BEFORE  (cost_primary                              + shipping + tariff) * (1 + markup/100)
--   AFTER   (cost_primary * (1 + commission/100)       + shipping + tariff) * (1 + markup/100)
--
-- Commission applies to cost_primary ALONE. Freight and duty do not carry it — they are paid to a
-- forwarder and a customs authority, not to the supplier's agent. That is why it cannot be folded into
-- markup or applied to the sum:
--
--   cost 100, shipping 20, commission 25%, markup 10%
--     RIGHT  (100 * 1.25 + 20) * 1.10 = 145.00 * 1.10 = 159.50
--     WRONG  (100 + 20) * 1.25 * 1.10 = 150.00 * 1.10 = 165.00
--
-- ── WHY PER SHIPMENT AND NOT ONLY PER TENANT ────────────────────────────────────────────────────────
--
-- A commission is a SUPPLIER term, and a shipment belongs to exactly one supplier. That was not a
-- hypothetical: the first two invoices uploaded came from PRIMAVERA and B&N, and nothing in the data
-- said whether they carried the same rate. They do — both 25% — but the reason this column exists is
-- that it could not be known from here, and that stays true for the next supplier.
--
-- ── WHAT HAPPENS TO EXISTING ROWS ───────────────────────────────────────────────────────────────────
--
-- A generated column's expression cannot be altered; it must be dropped and re-added, which recomputes
-- EVERY row from its current inputs. That is safe here because commission_percent defaults to 0 and
-- multiplying by (1 + 0/100) is the identity:
--
--   (12.00 * 1.00 + 2.746) * 1.10 = 16.2206   — exactly what the row already held
--
-- So the rewrite touches all 206 rows and moves none of them. Nothing on any screen changes when this
-- runs. Putting the 25% ONTO those rows is a separate, deliberate act: it happens by re-applying each
-- shipment through applyShipment, so every change passes the divergence flag and is recorded on the
-- shipment. See the notes at the end of this file.
--
-- Nothing depends on computed_cost — no index, no view, no policy, no check constraint, no function
-- returning product_costs%ROWTYPE — so dropping it takes nothing with it. Verified 7 Aug 2026.
--
-- Additive apart from the column rebuild. Run AFTER add_landed_cost_invoices_5.sql.
-- ============================================================================

-- ── 1. The defaults, and the per-supplier term ──────────────────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS cost_commission_percent numeric NOT NULL DEFAULT 0
    CHECK (cost_commission_percent >= 0);

COMMENT ON COLUMN tenants.cost_commission_percent IS
  'Default supplier commission for NEW cost rows, charged on the goods only. Existing rows keep their own snapshot — see add_cost_commission.sql.';

ALTER TABLE product_costs
  ADD COLUMN IF NOT EXISTS commission_percent numeric NOT NULL DEFAULT 0
    CHECK (commission_percent >= 0);

COMMENT ON COLUMN product_costs.commission_percent IS
  'The supplier commission snapshotted on THIS row. Applies to cost_primary only, never to shipping or tariff.';

ALTER TABLE landed_cost_shipments
  ADD COLUMN IF NOT EXISTS commission_percent numeric
    CHECK (commission_percent IS NULL OR commission_percent >= 0);

COMMENT ON COLUMN landed_cost_shipments.commission_percent IS
  'The supplier''s commission for this shipment. NULL leaves every product''s own snapshot alone (the markup rule); a value is authoritative for the products this shipment carries.';

-- ── 2. The generated column, rebuilt with the third term ────────────────────────────────────────────
--
-- DROP + ADD, not ALTER: Postgres has no syntax for changing a generation expression. The column
-- reappears at the END of the table's column order, which is invisible to PostgREST (name-based) and
-- to every function here (all use named columns, none uses SELECT * INTO a rowtype of this table).

ALTER TABLE product_costs DROP COLUMN IF EXISTS computed_cost;

ALTER TABLE product_costs
  ADD COLUMN computed_cost numeric GENERATED ALWAYS AS (
    CASE WHEN cost_primary IS NULL THEN NULL
         ELSE (cost_primary * (1 + commission_percent / 100) + shipping_cost + tariff_cost)
              * (1 + markup_percent / 100)
    END
  ) STORED;

COMMENT ON COLUMN product_costs.computed_cost IS
  'GENERATED. (cost_primary x (1 + commission/100) + shipping + tariff) x (1 + markup/100). The authoritative definition; lib/catalog/cost-math.ts is a mirror of it and must change in the same commit.';

-- ── 3. apply_shipment_costs: carry the shipment's term onto the products it moves ───────────────────
-- Rebuilt from the 6-argument version in add_landed_cost_invoices_5.sql. Two changes, both marked.

CREATE OR REPLACE FUNCTION apply_shipment_costs(
  p_tenant       uuid,
  p_shipment     uuid,
  p_actor        uuid    DEFAULT NULL,
  p_min_coverage numeric DEFAULT 0.80,
  p_reapply      boolean DEFAULT false,
  p_divergence   jsonb   DEFAULT NULL
)
RETURNS landed_cost_shipments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_shipment  landed_cost_shipments;
  v_invoice   supplier_invoices;
  v_default   numeric;
  v_comm      numeric;
  v_total     numeric;
  v_matched   numeric;
  v_matched_lines int;
  v_base      text;
  v_rate      numeric;
  v_charges   numeric;
  v_allocated numeric;
  v_before    jsonb;
BEGIN
  IF p_tenant IS NULL OR p_shipment IS NULL THEN
    RAISE EXCEPTION 'apply_shipment_costs: tenant and shipment are required';
  END IF;

  SELECT * INTO v_shipment FROM landed_cost_shipments
   WHERE id = p_shipment AND tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_shipment_costs: shipment not found for this tenant';
  END IF;

  IF v_shipment.status = 'applied' AND NOT p_reapply THEN
    RAISE EXCEPTION 'apply_shipment_costs: shipment was already applied at %; pass p_reapply to overwrite',
      v_shipment.applied_at;
  END IF;
  IF v_shipment.status NOT IN ('review','applied') THEN
    RAISE EXCEPTION 'apply_shipment_costs: shipment is %, not ready to apply', v_shipment.status;
  END IF;

  SELECT * INTO v_invoice FROM supplier_invoices
   WHERE shipment_id = p_shipment AND tenant_id = p_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_shipment_costs: shipment has no invoice';
  END IF;

  -- ── Guard 1: coverage. ───────────────────────────────────────────────────────────────────────────
  SELECT COALESCE(sum(extended), 0),
         COALESCE(sum(extended) FILTER (WHERE status = 'matched'), 0),
         count(*) FILTER (WHERE status = 'matched')
    INTO v_total, v_matched, v_matched_lines
    FROM supplier_invoice_lines WHERE invoice_id = v_invoice.id;

  IF v_matched_lines = 0 THEN
    RAISE EXCEPTION 'apply_shipment_costs: no matched lines — nothing to apply';
  END IF;
  IF v_matched = 0 THEN
    RAISE EXCEPTION 'apply_shipment_costs: % matched lines but they carry no value — nothing to allocate against',
      v_matched_lines;
  END IF;
  IF v_total > 0 AND (v_matched / v_total) < p_min_coverage THEN
    RAISE EXCEPTION 'apply_shipment_costs: matched % percent of invoice value, below the % percent required',
      round(100 * v_matched / v_total, 1), round(100 * p_min_coverage, 1);
  END IF;

  SELECT COALESCE(cost_base_currency, 'USD') INTO v_base FROM tenants WHERE id = p_tenant;

  -- ── Guard 2: FREIGHT is denominated in the currency the cost columns are kept in. ────────────────
  IF (v_shipment.freight_total + v_shipment.other_total + v_shipment.duties_total) > 0
     AND upper(v_shipment.currency) <> upper(v_base) THEN
    RAISE EXCEPTION 'apply_shipment_costs: freight is recorded in % but product costs are kept in %. Nothing here converts freight — it arrives from the forwarder in %, so re-enter it in %.',
      upper(v_shipment.currency), upper(v_base), upper(v_base), upper(v_base);
  END IF;

  -- ── Guard 2a: a foreign-currency INVOICE needs the rate that was paid on it. ─────────────────────
  IF upper(v_invoice.currency) <> upper(v_base)
     AND (v_invoice.exchange_rate IS NULL OR v_invoice.exchange_rate <= 0) THEN
    RAISE EXCEPTION 'apply_shipment_costs: this invoice is in % but costs are kept in %. Enter the exchange rate you paid on it (1 % = how many %) before applying — without it these products would take the freight but end up with no landed cost at all.',
      upper(v_invoice.currency), upper(v_base), upper(v_invoice.currency), upper(v_base);
  END IF;

  v_rate := CASE WHEN upper(v_invoice.currency) = upper(v_base) THEN 1 ELSE v_invoice.exchange_rate END;

  -- ── Guard 3: the allocation adds up. LINE totals, deliberately. ──────────────────────────────────
  v_charges := v_shipment.freight_total + v_shipment.other_total + v_shipment.duties_total;
  SELECT COALESCE(sum(allocated_freight + allocated_duties), 0) INTO v_allocated
    FROM supplier_invoice_lines WHERE invoice_id = v_invoice.id AND status = 'matched';

  IF abs(v_allocated - v_charges) > 0.01 THEN
    RAISE EXCEPTION 'apply_shipment_costs: allocation sums to % but the shipment charges are % — refusing to write',
      v_allocated, v_charges;
  END IF;

  -- ── CHANGE 1: applied_before now records the commission it is overwriting. ──────────────────────
  -- Without this key, a snapshot could not reproduce the computed_cost it was taken from once the
  -- formula has three terms. Snapshots captured before this migration have no key and read as 0,
  -- which is arithmetically what those rows carried — see lib/catalog/cost-provenance.ts.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'productId',          pc.product_id,
           'shippingCost',       pc.shipping_cost,
           'tariffCost',         pc.tariff_cost,
           'costPrimary',        pc.cost_primary,
           'costSecondary',      pc.cost_secondary,
           'markupPercent',      pc.markup_percent,
           'commissionPercent',  pc.commission_percent
         )), '[]'::jsonb)
    INTO v_before
    FROM product_costs pc
   WHERE pc.tenant_id = p_tenant
     AND pc.product_id IN (SELECT DISTINCT product_id FROM supplier_invoice_lines
                            WHERE invoice_id = v_invoice.id AND status = 'matched');

  SELECT COALESCE(cost_markup_percent, 10), COALESCE(cost_commission_percent, 0)
    INTO v_default, v_comm
    FROM tenants WHERE id = p_tenant;

  -- ── The write. EVERY figure below is PER UNIT. ───────────────────────────────────────────────────
  WITH per_product AS (
    SELECT l.product_id,
           COALESCE(NULLIF(sum(l.quantity), 0), 1)                          AS qty,
           sum(l.allocated_freight) / COALESCE(NULLIF(sum(l.quantity), 0), 1) AS freight_per_unit,
           sum(l.allocated_duties)  / COALESCE(NULLIF(sum(l.quantity), 0), 1) AS duties_per_unit,
           sum(l.extended)          / COALESCE(NULLIF(sum(l.quantity), 0), 1) AS unit_cost
      FROM supplier_invoice_lines l
     WHERE l.invoice_id = v_invoice.id AND l.status = 'matched' AND l.product_id IS NOT NULL
     GROUP BY l.product_id
  ),
  currencies AS (
    SELECT COALESCE(cost_base_currency, 'USD') AS base, cost_secondary_currency AS secondary
      FROM tenants WHERE id = p_tenant
  ),
  updated AS (
    UPDATE product_costs pc SET
      shipping_cost  = pp.freight_per_unit,
      tariff_cost    = pp.duties_per_unit,
      cost_primary   = COALESCE(pp.unit_cost * v_rate, pc.cost_primary),
      cost_secondary = CASE WHEN c.secondary IS NOT NULL AND upper(v_invoice.currency) = upper(c.secondary)
                            THEN COALESCE(pp.unit_cost, pc.cost_secondary) ELSE pc.cost_secondary END,
      -- markup_percent is deliberately absent. See add_landed_cost_invoices.sql.
      --
      -- ── CHANGE 2: commission IS written, and the asymmetry with markup is deliberate. ──────────
      -- A markup is OUR pricing decision and must not be rewritten retroactively. A commission is the
      -- SUPPLIER'S term for these specific goods, so when the shipment states one it is the truth
      -- about what was paid and it belongs on the row. When the shipment states nothing, COALESCE
      -- falls through to the row's existing snapshot and this behaves exactly like markup.
      commission_percent = COALESCE(v_shipment.commission_percent, pc.commission_percent, v_comm, 0),
      updated_at     = now(),
      updated_by     = p_actor
      FROM per_product pp, currencies c
     WHERE pc.product_id = pp.product_id AND pc.tenant_id = p_tenant
    RETURNING pc.product_id
  )
  INSERT INTO product_costs (
    tenant_id, product_id, variant_id,
    cost_primary, cost_secondary, shipping_cost, tariff_cost,
    markup_percent, commission_percent, updated_at, updated_by
  )
  SELECT p_tenant, pp.product_id, NULL,
         pp.unit_cost * v_rate,
         CASE WHEN c.secondary IS NOT NULL
               AND upper(v_invoice.currency) = upper(c.secondary) THEN pp.unit_cost END,
         pp.freight_per_unit, pp.duties_per_unit,
         COALESCE(v_default, 10),
         COALESCE(v_shipment.commission_percent, v_comm, 0),
         now(), p_actor
    FROM per_product pp, currencies c
   WHERE pp.product_id NOT IN (SELECT product_id FROM updated);

  UPDATE landed_cost_shipments SET
    status         = 'applied',
    applied_at     = now(),
    applied_by     = p_actor,
    applied_before = CASE WHEN v_shipment.applied_before IS NULL THEN v_before ELSE v_shipment.applied_before END,
    divergence_ack = p_divergence,
    updated_at     = now()
  WHERE id = p_shipment
  RETURNING * INTO v_shipment;

  RETURN v_shipment;
END;
$$;

REVOKE ALL ON FUNCTION apply_shipment_costs(uuid, uuid, uuid, numeric, boolean, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 4. create_product_with_cost: a brand-new row takes today's default ──────────────────────────────
-- The body below is the ORIGINAL from add_product_with_cost_rpc.sql, copied verbatim, with only the
-- four lines marked NEW added. It is reproduced in full because CREATE OR REPLACE has no other form —
-- not because it was rewritten. That block restoring column defaults (name, status, the quantities,
-- qr_code_token) after jsonb_populate_record is load-bearing: without it a created product violates
-- NOT NULL and loses its QR token.

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
    now(),
    p_actor
  );

  -- Any failure above raises and takes the product insert with it. That is the point: the owner sees
  -- the form refuse rather than a product saved without the cost they typed into it.
  RETURN v_product;
END;
$$;

REVOKE ALL ON FUNCTION create_product_with_cost(uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- ── 5. Your Design Collective: the term, on the tenant and on both shipments ────────────────────────
--
-- DATA, not schema, and scoped to one tenant on purpose. Both suppliers charge 25% on the goods, and
-- 25% is the default going forward.
--
-- Setting the shipments does NOT move a single cost by itself — it only tells the next apply what the
-- term is. The 206 rows change when each shipment is re-applied through the app, which is what puts
-- every change through the divergence flag and records it on the shipment.

UPDATE tenants
   SET cost_commission_percent = 25
 WHERE id = '8041c0b5-c960-48bd-a3f7-655f5a0b6434';

UPDATE landed_cost_shipments
   SET commission_percent = 25
 WHERE tenant_id = '8041c0b5-c960-48bd-a3f7-655f5a0b6434'
   AND id IN (
     '0ebd5ab6-f6ac-4696-8030-17ce30cbccd2',   -- PRIMAVERA FURNITURE 866/4/2026  (126 products, +20.34%)
     '54188c8b-6175-4f37-985f-932ec0ff6c6d'    -- B&N CONTRACT FURNITURE BN-1356  (80 products,  +17.28%)
   );

-- Confirms the rebuild moved nothing: every row should still hold the two-term figure, because
-- commission_percent is 0 on all of them until a shipment is re-applied.
--   SELECT count(*) FILTER (WHERE commission_percent = 0) AS untouched, count(*) FROM product_costs;

-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
--   ALTER TABLE product_costs DROP COLUMN computed_cost;
--   ALTER TABLE product_costs ADD COLUMN computed_cost numeric GENERATED ALWAYS AS (
--     CASE WHEN cost_primary IS NULL THEN NULL
--          ELSE (cost_primary + shipping_cost + tariff_cost) * (1 + markup_percent / 100) END) STORED;
-- then re-run apply_shipment_costs from add_landed_cost_invoices_5.sql and create_product_with_cost
-- from add_product_with_cost_rpc.sql.
--
-- WARNING: reversing AFTER a shipment has been re-applied with a commission silently drops that
-- commission from every landed cost, because the inputs remain but the expression stops reading them.
-- Set commission_percent back to 0 first if you actually want the old figures.
