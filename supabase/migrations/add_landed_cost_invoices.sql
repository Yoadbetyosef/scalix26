-- ============================================================================
-- Landed cost from supplier invoices — Phase 1.
--
-- An importer is quoted one freight figure for a whole consignment and pays it once. What they need is
-- that figure spread across the products it carried, so `computed_cost` — and therefore margin, and
-- therefore price — reflects what the goods actually cost to land. Today the owner types shipping and
-- duties per product by hand, from a PDF, with a calculator. This is that same act, done once per
-- shipment and shown to them before anything is written.
--
-- ── THREE TABLES, AND WHY NOT TWO ───────────────────────────────────────────────────────────────────
--
-- In phase 1 one invoice IS one shipment, and it would be smaller to hold both on one row. The reason
-- not to: freight is a property of the CONSIGNMENT, not of the document. The moment a container holds
-- three suppliers' invoices against one forwarder's bill — the case this feature exists to serve
-- eventually — `supplier_invoices.freight_total` becomes a column whose name is a lie, and renaming a
-- column that application code, an RPC and a UI all read is a worse migration than carrying a thin
-- table from the start. `landed_cost_shipments` is eight columns. Phase 2 is dropping one unique index
-- (supplier_invoices_shipment_uidx) and letting a shipment hold more than one invoice. Nothing renames.
--
-- ── WHAT ALLOCATION IS, STATED HONESTLY ─────────────────────────────────────────────────────────────
--
-- Freight is apportioned by line EXTENDED VALUE (quantity x unit price). Freight actually correlates
-- with weight and volume, which a supplier invoice does not carry, so value is a proxy — the one a
-- bookkeeper would use, and the UI says so rather than implying a precision that is not there.
--
-- The allocation itself is computed in TypeScript (lib/invoices/allocate.ts), not here, because it is
-- arithmetic with a rounding rule that has to be unit-tested and has to be VISIBLE ON SCREEN BEFORE IT
-- IS APPLIED. This schema stores the result per line; the function below only copies an already-
-- approved allocation into cost rows, and re-checks it before it does.
--
-- ── ACCESS ──────────────────────────────────────────────────────────────────────────────────────────
--
-- RLS enabled, NO policy — the newer pattern (catalog_products, add_catalog_ingestion_1.sql), not
-- `tenant_id = get_tenant_id()`. That predicate resolves the tenant from auth.uid() and therefore
-- returns the WRONG tenant whenever a White Label operator is working inside a client workspace, where
-- the active workspace lives in a cookie the database cannot see. Only the server, after auth + tenant
-- resolution + canViewCosts, reaches these rows.
--
-- Additive, idempotent. Safe to run more than once. Run in the Supabase SQL Editor.
-- ============================================================================

-- ── The bucket ──────────────────────────────────────────────────────────────────────────────────────
--
-- Created here rather than out-of-band in the dashboard (the way order-attachments was). The size limit
-- and the type list are enforced in three places — the file picker, the server, and storage itself —
-- and a bucket configured by hand is the one of the three free to drift, with the failure surfacing as
-- an opaque storage error rather than the sentence lib/invoices/types.ts wrote for the person holding
-- the file.
--
-- public = false, permanently. Files are reached only through short-lived signed URLs minted
-- server-side after the same gate every other read passes. A supplier invoice is the business's entire
-- cost structure, line by line.
--
-- 20 MB matches MAX_INVOICE_BYTES. HEIC is deliberately absent even though the orders allowlist
-- includes it: the vision API cannot read one, so accepting it here would mean storing a file that
-- fails at the moment the owner is waiting on an answer.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'supplier-invoices', 'supplier-invoices', false, 20971520,
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- No storage RLS policies, matching the tables below: the bucket is reached only by the service role,
-- after the application has resolved the tenant and checked canViewCosts.

-- ── The consignment ─────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS landed_cost_shipments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Owner-facing label ("Container 04/26", "Milan order"). Defaults to supplier + invoice number at
  -- creation; editable, because the name the business uses for a shipment is theirs, not ours.
  reference     text,

  -- The currency the CHARGES below are denominated in. Usually the invoice's, but a forwarder can bill
  -- in a third currency, which is exactly why it is here and not inherited from the document.
  currency      text NOT NULL DEFAULT 'USD',

  freight_total numeric NOT NULL DEFAULT 0 CHECK (freight_total >= 0),
  duties_total  numeric NOT NULL DEFAULT 0 CHECK (duties_total  >= 0),
  -- Handling, insurance, brokerage. Allocated exactly like freight and written to shipping_cost with
  -- it — the split that matters downstream is duty vs not-duty, because duty is what gets broken back
  -- out for customs paperwork.
  other_total   numeric NOT NULL DEFAULT 0 CHECK (other_total   >= 0),

  status        text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','extracting','review','applied','failed')),

  -- What the apply OVERWROTE, captured at the moment it ran: an array of
  -- { productId, shippingCost, tariffCost, costPrimary, costSecondary, markupPercent } as those rows
  -- stood beforehand. This is what lets a re-apply name what it will change instead of warning in the
  -- abstract, and it is the only record of the pre-invoice state once the cost rows are overwritten.
  applied_before jsonb,
  applied_at    timestamptz,
  applied_by    uuid,

  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS landed_cost_shipments_tenant_idx
  ON landed_cost_shipments (tenant_id, created_at DESC);

-- Composite target so invoices and lines can carry tenant-safe foreign keys (same reasoning as
-- add_variant_costs.sql: a cross-tenant reference should be unwritable, not merely checked in code).
DO $$ BEGIN
  ALTER TABLE landed_cost_shipments ADD CONSTRAINT landed_cost_shipments_id_tenant_key UNIQUE (id, tenant_id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

-- ── The document ────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shipment_id     uuid NOT NULL,

  supplier_name   text,
  invoice_number  text,
  invoice_date    date,
  currency        text NOT NULL DEFAULT 'USD',

  subtotal        numeric CHECK (subtotal    IS NULL OR subtotal    >= 0),
  tax_total       numeric CHECK (tax_total   IS NULL OR tax_total   >= 0),
  grand_total     numeric CHECK (grand_total IS NULL OR grand_total >= 0),

  -- The file itself lives in the private `supplier-invoices` bucket, reached only through short-lived
  -- signed URLs generated server-side — the same shape as order-attachments, a separate bucket because
  -- that one's paths and access reasoning are built around an order a supplier invoice does not have.
  storage_path    text NOT NULL,
  file_name       text NOT NULL,
  mime_type       text NOT NULL,
  file_size       bigint NOT NULL DEFAULT 0,
  -- sha256 of the bytes. Deliberately NOT unique: re-uploading the same PDF after a failed extraction
  -- is legitimate and must not be blocked. It is an index so the upload path can find the earlier
  -- shipment and show it, which is a better answer than a refusal.
  file_hash       text,
  page_count      int,

  status          text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded','extracting','extracted','failed')),
  extraction_error text,

  -- Anything that limited the MATCHING, in the owner's words, shown on the approval screen.
  --
  -- Exists because matching can degrade without failing: above a catalogue size we will not pull into
  -- memory, only SKUs are compared and names are not. "12 lines could not be matched" and "12 lines
  -- could not be matched, and names were never compared" are different facts that call for different
  -- actions, and a degradation the owner is not told about is indistinguishable from a catalogue that
  -- genuinely did not contain the goods.
  match_note      text,

  -- Every extraction's real spend, alongside the usage_events row lib/cost/track.ts writes. Kept here
  -- too because "what did this invoice cost to read" is a question about the invoice, and joining it
  -- back out of the meter by timestamp would be guesswork.
  extraction_model         text,
  extraction_input_tokens  int,
  extraction_output_tokens int,
  extraction_cost_usd      numeric,
  extraction_completion_id text,   -- Anthropic message id; the meter's resourceId, so the two reconcile

  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT supplier_invoices_shipment_tenant_fkey
    FOREIGN KEY (shipment_id, tenant_id) REFERENCES landed_cost_shipments (id, tenant_id) ON DELETE CASCADE
);

-- PHASE 1 ONLY: one invoice per shipment. Dropping this index is the whole of phase 2 — a shipment
-- gains the ability to hold several suppliers' invoices and nothing else changes.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoices_shipment_uidx ON supplier_invoices (shipment_id);

-- The two duplicate-detection reads. Neither constrains; both exist so the upload path can ask "have I
-- seen this before?" cheaply and answer with the shipment rather than an error.
CREATE INDEX IF NOT EXISTS supplier_invoices_hash_idx
  ON supplier_invoices (tenant_id, file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS supplier_invoices_number_idx
  ON supplier_invoices (tenant_id, lower(supplier_name), lower(invoice_number))
  WHERE invoice_number IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE supplier_invoices ADD CONSTRAINT supplier_invoices_id_tenant_key UNIQUE (id, tenant_id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

-- ── The lines ───────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id    uuid NOT NULL,
  line_no       int  NOT NULL,

  -- As extracted, never normalised in place. The raw text is what the owner checks the match against;
  -- overwriting it with our cleaned-up version would remove the only thing they can verify.
  description   text,
  sku           text,
  quantity      numeric,
  unit_price    numeric,
  -- Extended value: what the invoice says this line came to. Taken from the document when it states a
  -- line total, computed as quantity x unit_price when it does not. This is the allocation weight.
  extended      numeric NOT NULL DEFAULT 0 CHECK (extended >= 0),

  product_id    uuid,
  match_method  text CHECK (match_method IS NULL OR match_method IN ('exact_sku','normalized_sku','name_trigram','manual')),
  match_confidence numeric CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1)),

  -- 'unmatched' is "we could not find it"; 'skipped' is "the owner said don't". Both leave the
  -- allocation denominator, and they are separate values because they say different things about
  -- whether the resulting number can be trusted — the same reason catalog_retrieval_log keeps
  -- `errored` apart from `resolved`.
  status        text NOT NULL DEFAULT 'unmatched'
    CHECK (status IN ('unmatched','matched','skipped')),

  -- The allocation, recomputed in full whenever matching changes and stored so the approval screen and
  -- the apply are looking at the same numbers. Freight and other charges land together; duties stay
  -- apart because duty is precisely what gets broken back out for customs.
  allocated_freight numeric NOT NULL DEFAULT 0 CHECK (allocated_freight >= 0),
  allocated_duties  numeric NOT NULL DEFAULT 0 CHECK (allocated_duties  >= 0),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT supplier_invoice_lines_invoice_tenant_fkey
    FOREIGN KEY (invoice_id, tenant_id) REFERENCES supplier_invoices (id, tenant_id) ON DELETE CASCADE,
  -- A matched line points at a product of the SAME tenant, enforced by the database rather than by a
  -- check in application code. ON DELETE SET NULL, not CASCADE: deleting a product must not delete the
  -- record of an invoice line — the invoice happened, and the line is what the owner reconciles against.
  --
  -- The column list on SET NULL is load-bearing, not decoration. A composite foreign key nulls EVERY
  -- referencing column by default, so a plain SET NULL would try to null tenant_id as well and fail
  -- against its NOT NULL — turning "delete this product" into an error nobody could explain. Naming
  -- product_id restricts it to the column that should actually become null. (Postgres 15+.)
  CONSTRAINT supplier_invoice_lines_product_tenant_fkey
    FOREIGN KEY (product_id, tenant_id) REFERENCES catalog_products (id, tenant_id) ON DELETE SET NULL (product_id),
  -- Matched means matched to something. Unrepresentable rather than discouraged.
  CONSTRAINT supplier_invoice_lines_matched_has_product
    CHECK (status <> 'matched' OR product_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_lines_no_uidx ON supplier_invoice_lines (invoice_id, line_no);
CREATE INDEX IF NOT EXISTS supplier_invoice_lines_invoice_idx ON supplier_invoice_lines (invoice_id);
CREATE INDEX IF NOT EXISTS supplier_invoice_lines_product_idx
  ON supplier_invoice_lines (product_id) WHERE product_id IS NOT NULL;

-- ── Deleting a product un-matches its invoice lines ─────────────────────────────────────────────────
--
-- Two constraints above pull against each other on a product delete: the foreign key wants to null
-- product_id, and the CHECK says a 'matched' line must point at something. Left alone, deleting a
-- product that once appeared on an invoice would fail with a constraint error naming a table the
-- person has never heard of.
--
-- Resolving it in the application would mean every future delete path remembering to do this. Resolving
-- it with ON DELETE CASCADE would delete the invoice LINE, leaving a shipment showing eight of its ten
-- rows with its totals no longer adding up — a worse lie than the one being fixed.
--
-- So the database states what is actually true: a product that no longer exists is a product this line
-- is no longer matched to. The allocation it was holding is zeroed with it, because a share belonging
-- to nothing is not a share.
CREATE OR REPLACE FUNCTION unmatch_invoice_lines_for_deleted_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE supplier_invoice_lines
     SET product_id = NULL, match_method = NULL, match_confidence = NULL,
         status = 'unmatched', allocated_freight = 0, allocated_duties = 0, updated_at = now()
   WHERE product_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS catalog_products_unmatch_invoice_lines ON catalog_products;
CREATE TRIGGER catalog_products_unmatch_invoice_lines
  BEFORE DELETE ON catalog_products
  FOR EACH ROW EXECUTE FUNCTION unmatch_invoice_lines_for_deleted_product();

-- The shipment is left holding an allocation that no longer covers its charges, and apply_shipment_costs
-- would refuse it. That is why applyShipment() re-runs the allocation before calling the RPC: the
-- refusal is a last-resort guard against a bug, not a state the owner is expected to dig themselves
-- out of.

-- ── Access ──────────────────────────────────────────────────────────────────────────────────────────
-- Enabled with no policy: denied to anon and authenticated outright. See the header.

ALTER TABLE landed_cost_shipments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoice_lines ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- apply_shipment_costs — the allocation lands on every product, or on none.
--
-- ── WHY THIS IS AN RPC ──────────────────────────────────────────────────────────────────────────────
--
-- Applying a shipment writes one cost row per matched product. Made as N HTTP calls through PostgREST
-- those writes cannot be atomic, and a half-applied allocation is a worse state than a failed one: some
-- products carry this shipment's freight and some carry the last one's, with nothing on screen to say
-- which is which. It is the same failure create_product_with_cost was built to prevent, at N times the
-- surface area. Inside this function every write shares a transaction.
--
-- ── THE ACCESS TRADE, WHICH IS THE SECOND EXCEPTION AND SHOULD STAY THE LAST ────────────────────────
--
-- lib/catalog/costs.ts writes costs through the RLS-SCOPED client on purpose — a policy nothing
-- exercises is decoration. Two paths are now exempt: create_product_with_cost, and this. Both are
-- called with the ADMIN client, both because atomicity across tables is the thing being bought.
--
-- What makes it acceptable here is the same as there, plus one addition: the protection is not merely
-- moved to the application layer, it is DUPLICATED IN THIS FUNCTION. requireCatalogTenant() and
-- canViewCosts gate the route, p_tenant is server-resolved and never comes from a payload — and then
-- every guard below re-derives from the database rather than trusting what the caller computed. The
-- coverage threshold, the allocation total, and the tenancy of every product touched are all re-checked
-- here. A bug in the TypeScript cannot write a wrong allocation through this function; it can only fail.
--
-- What has NOT changed: the cost card, variants, applyCurrentMarkup and saveCost all still go through
-- the RLS client. The policy on product_costs is exercised constantly.
--
-- SECURITY INVOKER, deliberately NOT DEFINER: this function holds no privilege of its own. It runs with
-- whatever the caller has, and the caller is the admin client the route already uses. DEFINER would
-- hand it standing privilege and hide this trade instead of stating it.
--
-- ── THE MARKUP RULE, WHICH IS THE ONE THAT CORRUPTS HISTORY SILENTLY ────────────────────────────────
--
-- markup_percent is snapshotted when a cost row is first written so that changing the tenant default
-- later never rewrites what a product cost last quarter. This function UPDATES existing rows, so it
-- must leave markup_percent exactly as it found it; only a row that did not exist takes today's
-- default. That is the same rule saveCost() applies, restated here because this is a second writer and
-- a rule enforced in only one of two places is not enforced.
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_shipment_costs(
  p_tenant       uuid,
  p_shipment     uuid,
  p_actor        uuid    DEFAULT NULL,
  p_min_coverage numeric DEFAULT 0.80,   -- share of invoice value that must be matched; 0 = owner override
  p_reapply      boolean DEFAULT false   -- an already-applied shipment is never re-applied by accident
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
  v_total     numeric;   -- invoice value across every line
  v_matched   numeric;   -- invoice value across matched lines only
  v_matched_lines int;   -- how many lines that is, which is a different question
  v_base      text;      -- the tenant's base currency, which the cost columns are denominated in
  v_charges   numeric;   -- freight + other + duties, as the shipment records them
  v_allocated numeric;   -- what the stored per-line allocation actually sums to
  v_before    jsonb;
BEGIN
  IF p_tenant IS NULL OR p_shipment IS NULL THEN
    RAISE EXCEPTION 'apply_shipment_costs: tenant and shipment are required';
  END IF;

  -- Locked for the duration: two approvals racing must not both read 'review' and both apply.
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

  -- ── Guard 1: coverage. Re-derived here, not taken from the caller. ──────────────────────────────
  -- Count and value are read separately on purpose: an invoice whose lines are all matched but all
  -- zero-valued is a different fault from one with nothing matched, and reporting the second when the
  -- first happened would send the owner looking in the wrong place.
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
  -- No literal percent sign in the message: in RAISE, `%` is the placeholder and `%%` is an escaped
  -- percent, so "45.0%" cannot be written unambiguously. The word costs nothing and the error works.
  IF v_total > 0 AND (v_matched / v_total) < p_min_coverage THEN
    RAISE EXCEPTION 'apply_shipment_costs: matched % percent of invoice value, below the % percent required',
      round(100 * v_matched / v_total, 1), round(100 * p_min_coverage, 1);
  END IF;

  -- ── Guard 2: the freight is denominated in the currency the cost columns are kept in. ────────────
  --
  -- shipping_cost and tariff_cost are base-currency columns — that is what the cost card's labels
  -- promise and what computed_cost sums against cost_primary. Nothing in this system converts
  -- currencies and no FX rate is stored anywhere, because a stored rate is a wrong rate. So a shipment
  -- whose freight was read off a EUR forwarder's bill cannot be written into a USD column: the number
  -- would land silently, look plausible, and be wrong by whatever the rate happens to be.
  --
  -- The charges are editable on the approval screen, so this is a fixable state and the message says
  -- how. Only enforced when there is something to write — a shipment with no charges at all has no
  -- currency problem.
  SELECT COALESCE(cost_base_currency, 'USD') INTO v_base FROM tenants WHERE id = p_tenant;
  IF (v_shipment.freight_total + v_shipment.other_total + v_shipment.duties_total) > 0
     AND upper(v_shipment.currency) <> upper(v_base) THEN
    RAISE EXCEPTION 'apply_shipment_costs: freight is recorded in % but product costs are kept in %. Nothing here converts currencies — re-enter the freight and duty in %.',
      upper(v_shipment.currency), upper(v_base), upper(v_base);
  END IF;

  -- ── Guard 3: the allocation adds up. A rounding bug in the application would otherwise write an
  -- allocation that quietly loses or invents money; here it fails instead. One cent of slack, because
  -- largest-remainder distribution is exact and anything beyond a cent is a real defect.
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

  -- ── The write. One row per PRODUCT, not per line: an invoice may list the same SKU twice and those
  -- lines' allocations belong together on the one cost row.
  --
  -- Unit cost follows the no-conversion rule the schema already states: a supplier figure is written to
  -- cost_primary only when the invoice is already in the tenant's base currency, and to cost_secondary
  -- only when it is in their declared secondary. In any third currency neither is touched — freight and
  -- duties still land, and computed_cost stays NULL, which is the honest answer rather than an invented
  -- FX rate. (cost_secondary is reference only; it never enters the arithmetic.)
  WITH per_product AS (
    SELECT l.product_id,
           sum(l.allocated_freight) AS freight,
           sum(l.allocated_duties)  AS duties,
           -- Weighted unit cost when one product appears on several lines at different prices: total
           -- paid over total quantity, which is what the next unit actually costs.
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
      cost_primary   = CASE WHEN upper(v_invoice.currency) = upper(c.base)
                            THEN COALESCE(pp.unit_cost, pc.cost_primary) ELSE pc.cost_primary END,
      cost_secondary = CASE WHEN c.secondary IS NOT NULL AND upper(v_invoice.currency) = upper(c.secondary)
                            THEN COALESCE(pp.unit_cost, pc.cost_secondary) ELSE pc.cost_secondary END,
      -- markup_percent is deliberately absent. See the header.
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
         CASE WHEN upper(v_invoice.currency) = upper(c.base)      THEN pp.unit_cost END,
         CASE WHEN c.secondary IS NOT NULL
               AND upper(v_invoice.currency) = upper(c.secondary) THEN pp.unit_cost END,
         pp.freight, pp.duties,
         COALESCE(v_default, 10),   -- a brand-new row, and only a brand-new row, takes today's default
         now(), p_actor
    FROM per_product pp, currencies c
   WHERE pp.product_id NOT IN (SELECT product_id FROM updated);

  UPDATE landed_cost_shipments SET
    status         = 'applied',
    applied_at     = now(),
    applied_by     = p_actor,
    -- Only on a first apply. A re-apply must not overwrite the record of what the world looked like
    -- before this shipment ever touched it — that snapshot is the only way back.
    applied_before = CASE WHEN v_shipment.applied_before IS NULL THEN v_before ELSE v_shipment.applied_before END,
    updated_at     = now()
  WHERE id = p_shipment
  RETURNING * INTO v_shipment;

  -- Any failure above raises and takes every write with it. That is the point: the owner sees an
  -- approval that refused, not half a shipment spread across their catalogue.
  RETURN v_shipment;
END;
$$;

-- Only the server calls this. Nothing client-side may rewrite cost rows in bulk.
REVOKE ALL ON FUNCTION apply_shipment_costs(uuid, uuid, uuid, numeric, boolean) FROM PUBLIC, anon, authenticated;

-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS apply_shipment_costs(uuid, uuid, uuid, numeric, boolean);
-- DROP TABLE IF EXISTS supplier_invoice_lines CASCADE;
-- DROP TABLE IF EXISTS supplier_invoices CASCADE;
-- DROP TABLE IF EXISTS landed_cost_shipments CASCADE;
--
-- Dropping these removes the invoices and the record of what was applied. It does NOT revert cost rows
-- to their pre-invoice values — those are ordinary product_costs rows now, indistinguishable from ones
-- typed by hand. Read applied_before off the shipments first if that is what you need.
