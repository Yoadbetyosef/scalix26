-- ============================================================================
-- Landed cost — Phase 1d: record that somebody was WARNED before a margin moved.
--
-- ── THE QUESTION THIS EXISTS TO ANSWER ──────────────────────────────────────────────────────────────
--
-- Six months after a shipment lands, somebody asks "why is this sofa's margin 19%?" Today the answer
-- has to be guessed at: applied_before says what the cost used to be, so the MOVE is reconstructable,
-- but nothing anywhere records whether anyone noticed it happening. A cost that collapsed a margin and
-- a cost that was reviewed and accepted look identical afterwards.
--
-- divergence_ack stores what was on screen at the moment of the apply, in the words it was on screen
-- in: which products moved, from what to what, what that did to their margins, and — because the write
-- only reaches this function once the caller has passed the acknowledgement — that a human was told.
--
-- ── WHY THIS IS RECORDED HERE AND NOT ENFORCED HERE ─────────────────────────────────────────────────
--
-- Every other guard in this function is re-derived in SQL rather than trusted from the caller, and that
-- is deliberate: a bug in TypeScript can fail an apply but cannot corrupt a cost row. This one is the
-- exception, and the reason is not laziness.
--
-- SQL can recompute which costs move materially. It cannot recompute the fact the gate is about — that
-- a person was shown a sentence and went ahead anyway. That fact exists only in the caller, so the
-- caller owns the gate (lib/invoices/store.ts, applyShipment) and this function owns the record.
--
-- The payload is therefore EVIDENCE, not input: nothing here reads it, no guard depends on it, and no
-- cost row changes shape because of it. The worst a wrong value can do is make the audit trail wrong,
-- which is bad but is not the same kind of bad as a wrong cost.
--
-- Additive. Run AFTER add_landed_cost_invoices_4.sql.
-- ============================================================================

ALTER TABLE landed_cost_shipments
  ADD COLUMN IF NOT EXISTS divergence_ack jsonb;

COMMENT ON COLUMN landed_cost_shipments.divergence_ack IS
  'What the owner was shown about materially-moving costs at the moment of apply, and therefore that they were shown it. Evidence, never input — see add_landed_cost_invoices_5.sql. Null means nothing moved enough to flag.';

-- ── The function gains a parameter, so it must be dropped and recreated. ────────────────────────────
-- CREATE OR REPLACE cannot add an argument; it would create a second overload, and two functions
-- differing only by a defaulted trailing parameter make every call ambiguous.
DROP FUNCTION IF EXISTS apply_shipment_costs(uuid, uuid, uuid, numeric, boolean);

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
    -- Unlike applied_before, this is NOT first-write-wins. applied_before must survive a re-apply
    -- because it is the only record of the ORIGINAL costs; this is a record of a decision, and a second
    -- apply is a second decision taken against whatever the figures were by then. Overwriting keeps
    -- the row honest about the apply that actually produced the numbers now in product_costs.
    divergence_ack = p_divergence,
    updated_at     = now()
  WHERE id = p_shipment
  RETURNING * INTO v_shipment;

  RETURN v_shipment;
END;
$$;

REVOKE ALL ON FUNCTION apply_shipment_costs(uuid, uuid, uuid, numeric, boolean, jsonb) FROM PUBLIC, anon, authenticated;

-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS apply_shipment_costs(uuid, uuid, uuid, numeric, boolean, jsonb);
-- then re-run the 5-argument definition from add_landed_cost_invoices_3.sql.
--
-- Leave the column in place. Dropping it destroys the record of every divergence anyone was ever shown,
-- and an unread jsonb column costs nothing.
