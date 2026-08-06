-- ============================================================================
-- Landed cost — Phase 1b: the exchange rate, and freight as a suggestion.
--
-- Fixes a design that could not express the shape it was built for. An importer's numbers arrive from
-- TWO documents in TWO currencies:
--
--   • the supplier's invoice — line values in EUR
--   • the freight forwarder's bill — shipping and duties in USD
--
-- Phase 1 carried one currency per shipment and seeded it from the invoice, so a EUR invoice stamped
-- the freight field EUR and apply_shipment_costs correctly refused it. The columns were always right;
-- what was wrong was the code filling them and a missing rate. Both are addressed here.
--
-- ── WHY A STORED RATE IS CORRECT HERE, HAVING BEEN WRONG EVERYWHERE ELSE ────────────────────────────
--
-- add_product_costs.sql says: "No FX rate is stored anywhere, because a stored rate is a wrong rate."
-- That was written against a TENANT-WIDE rate — one number on the business, applied to every product
-- forever, silently drifting from the market every day after it was typed.
--
-- This is not that. It is the rate the owner actually PAID on ONE invoice, recorded once, on the
-- document it belongs to, and never applied to anything else. It does not go stale because it is not a
-- forecast — it is a historical fact about a transaction that already happened. The earlier doctrine
-- was read too broadly and this feature shipped with no way to convert at all; a EUR invoice produced
-- products with freight, a EUR reference figure, and no landed cost whatsoever.
--
-- The scope of the rate is the reason it is safe, so keep it: ONE invoice, LINE VALUES ONLY.
--
-- ── AND WHY FREIGHT IS NEVER MULTIPLIED BY IT ───────────────────────────────────────────────────────
--
-- Read this before "fixing" the omission below.
--
-- Freight is not converted because IT NEVER ARRIVES IN A FOREIGN CURRENCY. It comes from the freight
-- forwarder, billed in the tenant's own currency, and is typed in by hand from that bill. There is
-- nothing to convert. The absence of a multiplication here is not an oversight and applying the
-- invoice's rate to it would take a correct USD figure and corrupt it by whatever EUR/USD happened to
-- be — a wrong number with no symptom, on the exact column the whole feature exists to fill.
--
-- If a tenant ever receives a forwarder's bill in a foreign currency, that is a DIFFERENT design — a
-- second rate, belonging to the forwarder's document, not this one. It is not this rate applied to one
-- more field.
--
-- Additive, idempotent. Run AFTER add_landed_cost_invoices.sql.
-- ============================================================================

-- ── The rate ────────────────────────────────────────────────────────────────────────────────────────
--
-- How many units of the TENANT'S BASE currency one unit of the INVOICE'S currency buys. For a USD
-- business holding a EUR invoice at 1 EUR = 1.08 USD, this is 1.08 — the direction the owner reads off
-- their own bank statement, and the direction the screen labels.
--
-- NULL is the ordinary state for an invoice already in base currency, where there is nothing to
-- convert. NULL on a FOREIGN-currency invoice blocks the apply outright (see the guard below): a
-- product carrying this shipment's freight but no landed cost is worse than a form that will not
-- submit, and silently skipping cost_primary is precisely how the gap this migration closes got in.
ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS exchange_rate numeric
  CHECK (exchange_rate IS NULL OR exchange_rate > 0);

-- ── Freight as the supplier stated it — a SUGGESTION, never a value ─────────────────────────────────
--
-- Some supplier invoices print their own freight line. Phase 1 wrote it straight onto the shipment,
-- which put a EUR figure into a USD column the moment the invoice was foreign.
--
-- It is still extracted, because it is genuinely useful to see what the supplier billed for carriage
-- next to what the forwarder billed — sometimes they are the same shipment quoted twice, and that is
-- worth catching. But it lands HERE, on the document, where it is read-only evidence. The shipment's
-- freight_total is only ever typed by a person reading the forwarder's bill.
ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS extracted_freight numeric;
ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS extracted_duties  numeric;
ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS extracted_other   numeric;

COMMENT ON COLUMN supplier_invoices.exchange_rate IS
  'Base currency per one unit of invoice currency, for THIS invoice only. Applies to line values only — never to freight, which arrives already in base currency from the forwarder.';
COMMENT ON COLUMN supplier_invoices.extracted_freight IS
  'Freight as printed on the SUPPLIER invoice, in the invoice currency. Evidence only — never written to landed_cost_shipments.freight_total, which comes from the forwarder in base currency.';

-- ============================================================================
-- apply_shipment_costs — replaced, to convert line values and to refuse without a rate.
--
-- Everything from add_landed_cost_invoices.sql still holds and is not restated: why this is an RPC, the
-- admin-client access trade, and the markup rule (markup_percent is preserved on existing rows; only a
-- brand-new row takes today's default). Read that header first — this one covers only what changed.
--
-- WHAT CHANGED
--   • Guard 2a: a foreign-currency invoice with no exchange rate is refused, by name.
--   • cost_primary is now unit_cost x rate, with the rate pinned to 1 for a base-currency invoice, so
--     there is one code path and no branch that can silently leave cost_primary unwritten.
--   • Guard 2 (freight currency) is unchanged and deliberately so. It passes on the merits once the
--     application stops seeding the shipment's currency from the invoice: freight is USD, the column is
--     USD. It was never widened to make an upload work.
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
  v_rate      numeric;   -- base currency per unit of invoice currency; 1 when they are the same
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
  -- Unchanged from the first migration. This is about landed_cost_shipments.currency — the forwarder's
  -- bill — NOT the invoice's, which is allowed to be foreign and is handled by the rate below.
  IF (v_shipment.freight_total + v_shipment.other_total + v_shipment.duties_total) > 0
     AND upper(v_shipment.currency) <> upper(v_base) THEN
    RAISE EXCEPTION 'apply_shipment_costs: freight is recorded in % but product costs are kept in %. Nothing here converts freight — it arrives from the forwarder in %, so re-enter it in %.',
      upper(v_shipment.currency), upper(v_base), upper(v_base), upper(v_base);
  END IF;

  -- ── Guard 2a: a foreign-currency INVOICE needs the rate that was paid on it. ─────────────────────
  -- Refused rather than skipped. Writing freight and duty while quietly leaving cost_primary NULL would
  -- produce a product with a landed cost of nothing at all — no total, no margin — and no indication on
  -- any screen of why. That failure is what this guard exists to make impossible.
  IF upper(v_invoice.currency) <> upper(v_base)
     AND (v_invoice.exchange_rate IS NULL OR v_invoice.exchange_rate <= 0) THEN
    RAISE EXCEPTION 'apply_shipment_costs: this invoice is in % but costs are kept in %. Enter the exchange rate you paid on it (1 % = how many %) before applying — without it these products would take the freight but end up with no landed cost at all.',
      upper(v_invoice.currency), upper(v_base), upper(v_invoice.currency), upper(v_base);
  END IF;

  -- One rate, one path. Pinning it to 1 for a base-currency invoice means the multiplication below is
  -- unconditional — there is no branch left in which cost_primary silently goes unwritten.
  v_rate := CASE WHEN upper(v_invoice.currency) = upper(v_base) THEN 1 ELSE v_invoice.exchange_rate END;

  -- ── Guard 3: the allocation adds up. ─────────────────────────────────────────────────────────────
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

  -- ── The write. One row per PRODUCT, not per line. ────────────────────────────────────────────────
  --
  -- THREE currencies meet here and only one of them moves:
  --
  --   cost_primary   ← unit cost x v_rate       CONVERTED. Invoice currency into base currency.
  --   cost_secondary ← unit cost, untouched     The supplier's own figure, kept for reconciliation
  --                                             against the paper. Never enters the arithmetic.
  --   shipping_cost  ← the allocation           NOT CONVERTED, and not because anyone forgot. Freight
  --   tariff_cost    ← the allocation           arrives from the forwarder ALREADY in base currency.
  --                                             There is nothing to convert. Multiplying it by v_rate
  --                                             would corrupt a correct figure by the EUR/USD rate,
  --                                             with no symptom, on the column this feature exists to
  --                                             fill. See the header before changing this.
  --
  -- The allocation being unconverted is also arithmetically safe on its own terms: allocation weights
  -- are RATIOS of line values, so the currency cancels. A EUR-weighted split of a USD freight pool is
  -- a USD result.
  WITH per_product AS (
    SELECT l.product_id,
           sum(l.allocated_freight) AS freight,
           sum(l.allocated_duties)  AS duties,
           -- Weighted unit cost, in the INVOICE's currency, when one product appears on several lines.
           CASE WHEN sum(l.quantity) > 0 THEN sum(l.extended) / sum(l.quantity) END AS unit_cost
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
      shipping_cost  = pp.freight,
      tariff_cost    = pp.duties,
      cost_primary   = COALESCE(pp.unit_cost * v_rate, pc.cost_primary),
      -- Only when the tenant has declared this currency as their secondary; otherwise there is no
      -- labelled field to show it in and the figure would be stored unreadable. Nothing is lost either
      -- way — supplier_invoice_lines keeps every original figure exactly as extracted.
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
         pp.freight, pp.duties,
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
-- ALTER TABLE supplier_invoices
--   DROP COLUMN IF EXISTS exchange_rate,
--   DROP COLUMN IF EXISTS extracted_freight,
--   DROP COLUMN IF EXISTS extracted_duties,
--   DROP COLUMN IF EXISTS extracted_other;
-- Then re-run the apply_shipment_costs definition from add_landed_cost_invoices.sql.
--
-- Dropping exchange_rate does NOT unconvert anything already applied: cost_primary rows are ordinary
-- numbers afterwards, indistinguishable from ones typed by hand.
