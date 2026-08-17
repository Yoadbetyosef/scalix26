-- ============================================================================
-- Landed cost — Phase 1c: the allocation is written PER UNIT, not per line.
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────────────────────────────
--
-- apply_shipment_costs wrote a line's WHOLE allocated freight into product_costs.shipping_cost, next to
-- a cost_primary that was already per unit. Those are different denominators sitting in the same sum.
--
-- product_costs is per unit throughout, and every consumer assumes it:
--
--   cost_primary   is what ONE unit cost                (sum(extended) / sum(quantity))
--   computed_cost  is (cost_primary + shipping_cost + tariff_cost) x markup
--   margin         compares computed_cost against catalog_products.price — ONE unit's selling price
--
-- So an invoice line for 2 sofas at 4,000 each, taking 1,454.55 of freight, wrote 1,454.55 against a
-- unit cost of 4,320 — giving each sofa BOTH sofas' freight. Landed cost overstated by roughly the
-- quantity, silently, on the column this entire feature exists to fill. A line for 20 cushions was
-- overstated twentyfold.
--
-- Nothing would have caught it downstream: the figure is plausible, the allocation still summed to the
-- charges (guard 3 checks LINE totals, which were right), and the margin just came out low.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────────────────────────────
--
-- Divide by the same quantity cost_primary is already divided by, in the same expression, so the two
-- cannot drift apart again. A line with no quantity counts as one unit — there is nothing to divide by,
-- and the line's own total is then the best answer for what its single unit cost.
--
-- The LINE-level allocation is untouched: supplier_invoice_lines.allocated_freight is still the whole
-- line's share, which is what the invoice weights mean, what the approval screen shows against a line,
-- and what guard 3 sums against the shipment's charges. Only the write into product_costs divides.
--
-- Additive, idempotent. Run AFTER add_landed_cost_invoices_2.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_shipment_costs(
  p_tenant       uuid,
  p_shipment     uuid,
  p_actor        uuid    DEFAULT NULL,
  p_min_coverage numeric DEFAULT 0.80,
  p_reapply      boolean DEFAULT false
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
  -- This checks the allocation, which is a per-line quantity, against the charges. The per-unit
  -- division below happens after this and does not belong in it.
  v_charges := v_shipment.freight_total + v_shipment.other_total + v_shipment.duties_total;
  SELECT COALESCE(sum(allocated_freight + allocated_duties), 0) INTO v_allocated
    FROM supplier_invoice_lines WHERE invoice_id = v_invoice.id AND status = 'matched';

  IF abs(v_allocated - v_charges) > 0.01 THEN
    RAISE EXCEPTION 'apply_shipment_costs: allocation sums to % but the shipment charges are % — refusing to write',
      v_allocated, v_charges;
  END IF;

  -- ── What we are about to overwrite, captured before we do. ──────────────────────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'productId',     pc.product_id,
           'shippingCost',  pc.shipping_cost,
           'tariffCost',    pc.tariff_cost,
           'costPrimary',   pc.cost_primary,
           'costSecondary', pc.cost_secondary,
           'markupPercent', pc.markup_percent
         )), '[]'::jsonb)
    INTO v_before
    FROM product_costs pc
   WHERE pc.tenant_id = p_tenant
     AND pc.product_id IN (SELECT DISTINCT product_id FROM supplier_invoice_lines
                            WHERE invoice_id = v_invoice.id AND status = 'matched');

  SELECT COALESCE(cost_markup_percent, 10) INTO v_default FROM tenants WHERE id = p_tenant;

  -- ── The write. EVERY figure below is PER UNIT. ───────────────────────────────────────────────────
  --
  -- qty is computed once and all three per-unit figures divide by it, in the same expression, so unit
  -- cost and unit freight cannot drift onto different denominators again. COALESCE(NULLIF(...)) makes a
  -- missing or zero quantity behave as one unit rather than producing a division by zero or a NULL that
  -- would silently drop the row's cost.
  --
  -- Currencies, unchanged: cost_primary converts at v_rate, cost_secondary keeps the supplier's own
  -- figure untouched, and freight is NOT converted because it arrives from the forwarder already in
  -- base currency. See add_landed_cost_invoices_2.sql before changing that.
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
      updated_at     = now(),
      updated_by     = p_actor
      FROM per_product pp, currencies c
     WHERE pc.product_id = pp.product_id AND pc.tenant_id = p_tenant
    RETURNING pc.product_id
  )
  INSERT INTO product_costs (
    tenant_id, product_id, variant_id,
    cost_primary, cost_secondary, shipping_cost, tariff_cost,
    markup_percent, updated_at, updated_by
  )
  SELECT p_tenant, pp.product_id, NULL,
         pp.unit_cost * v_rate,
         CASE WHEN c.secondary IS NOT NULL
               AND upper(v_invoice.currency) = upper(c.secondary) THEN pp.unit_cost END,
         pp.freight_per_unit, pp.duties_per_unit,
         COALESCE(v_default, 10),
         now(), p_actor
    FROM per_product pp, currencies c
   WHERE pp.product_id NOT IN (SELECT product_id FROM updated);

  UPDATE landed_cost_shipments SET
    status         = 'applied',
    applied_at     = now(),
    applied_by     = p_actor,
    applied_before = CASE WHEN v_shipment.applied_before IS NULL THEN v_before ELSE v_shipment.applied_before END,
    updated_at     = now()
  WHERE id = p_shipment
  RETURNING * INTO v_shipment;

  RETURN v_shipment;
END;
$$;

REVOKE ALL ON FUNCTION apply_shipment_costs(uuid, uuid, uuid, numeric, boolean) FROM PUBLIC, anon, authenticated;

-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
-- Re-run the apply_shipment_costs definition from add_landed_cost_invoices_2.sql. Note that doing so
-- reinstates the per-line/per-unit mismatch described at the top of this file.
--
-- Any shipment APPLIED before this migration wrote line-total freight into per-unit columns. Those
-- product_costs rows are overstated by their line quantity and this migration does not correct them —
-- re-apply the affected shipments, or fix the rows by hand.
