-- ============================================================================
-- THE TAX AN ORDER WAS ACTUALLY CHARGED AT.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- Today an order stores `delivery_province` and nothing else, and the rate is
-- resolved AT RENDER TIME by rateFor(). That means editing tax_rates silently
-- re-renders every document already in a customer's hands at the new figure.
-- Nova Scotia is the only thing protected from it, and only because
-- effective_from dating happens to catch it.
--
-- These five columns are the snapshot that fixes it.
--
-- ── WHY THE RATE IS NOT LOOKED UP FROM tax_rates ANY MORE ──────────────────
--
-- Because one province can now mean two rates. A BC sale is 12% (GST + PST) at
-- retail and 5% (GST only) wholesale to a business for resale, and BOTH are
-- correct — the seller chooses, per sale, and the reason for choosing is the
-- exemption, not anything about the customer.
--
-- tax_rates cannot express that: it is keyed UNIQUE (country, region,
-- effective_from), so its only axis for two rows in one province is TIME.
-- That axis is right for what it does — NS 15% before April 2025, 14% after —
-- and adding a second one to encode "kind of sale" would overload a table whose
-- whole design is "a rate is current until a later row supersedes it".
--
-- So the CHOICES live in lib/tax/canada.ts, the CHOSEN one is stored here, and
-- tax_rates keeps its single job: the statutory rate for a region on a date.
--
-- ── tax_kind DESCRIBES THE RATE, NOT THE CUSTOMER ──────────────────────────
--
-- 'gst_only' | 'combined'. Not 'wholesale' / 'retail': those name a kind of
-- customer, and the column would then be asserting something about who bought
-- it that nothing here can support. What is actually true is narrower and
-- checkable — one figure is GST alone, the other is GST plus the province's own
-- tax. Why that was chosen is the exemption, and the exemption is two columns
-- down where it can be printed.
--
-- HST provinces have no kind at all. There is one rate and it applies either
-- way, so there is nothing to choose and the column stays null.
--
-- ── NOTHING IS BACKFILLED, DELIBERATELY ────────────────────────────────────
--
-- Existing orders get no snapshot. document-data.ts prefers a snapshot and
-- falls back to today's live lookup when there is none, so every document
-- already raised renders EXACTLY as it does now. Writing a snapshot onto them
-- would be this migration deciding, retrospectively, which of two correct rates
-- a sale was made at — which is the seller's judgement and nobody else's.
-- ============================================================================

ALTER TABLE orders
  -- The snapshot. Written when the seller picks a rate; null on every order
  -- raised before this existed.
  ADD COLUMN IF NOT EXISTS tax_kind            text,
  ADD COLUMN IF NOT EXISTS tax_label           text,
  ADD COLUMN IF NOT EXISTS tax_rate_percent    numeric(6,3),
  -- The assertion, and the sentence that explains it. Off by default: an
  -- exemption nobody claimed must never appear on a document.
  ADD COLUMN IF NOT EXISTS pst_exempt          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pst_exemption_note  text;

-- numeric(6,3) matches tax_rates.rate_percent exactly. QC's 14.975 is the row
-- that needs the three decimals, and a snapshot that rounded differently from
-- the table it came from would be a discrepancy nobody could explain later.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_tax_kind_check;
ALTER TABLE orders ADD CONSTRAINT orders_tax_kind_check
  CHECK (tax_kind IS NULL OR tax_kind IN ('gst_only', 'combined'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_tax_rate_check;
ALTER TABLE orders ADD CONSTRAINT orders_tax_rate_check
  CHECK (tax_rate_percent IS NULL OR tax_rate_percent >= 0);

-- A HALF-SNAPSHOT IS THE ONE STATE THAT MUST NOT EXIST. A label with no rate
-- prints "GST + PST" beside nothing; a rate with no label prints a figure the
-- customer cannot identify. Both are worse than no tax line, and both are the
-- kind of thing that only shows up on a document somebody has already sent.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_tax_snapshot_whole;
ALTER TABLE orders ADD CONSTRAINT orders_tax_snapshot_whole
  CHECK ((tax_label IS NULL) = (tax_rate_percent IS NULL));

COMMENT ON COLUMN orders.tax_kind IS
  'gst_only | combined — WHICH READING of the province''s tax was charged, not a kind of customer. Null for HST provinces, which have one rate, and for orders raised before the picker existed.';
COMMENT ON COLUMN orders.tax_label IS
  'SNAPSHOT of what the document prints beside the amount: GST, HST, GST + PST, GST + RST. Never re-read from tax_rates — changing a rate next year must not alter a document a customer already holds.';
COMMENT ON COLUMN orders.tax_rate_percent IS
  'SNAPSHOT of the rate charged. Same numeric(6,3) as tax_rates.rate_percent. The AMOUNT is not stored: it is arithmetic on the subtotal printed directly above it, and a stored amount would go stale the moment a line was edited.';
COMMENT ON COLUMN orders.pst_exempt IS
  'The seller ASSERTS the provincial portion does not apply — a resale certificate or equivalent. Off by default. This is a record of a claim, not a validated exemption: nothing here checks a certificate and nothing should pretend to.';
COMMENT ON COLUMN orders.pst_exemption_note IS
  'Printed beneath the tax line, and ONLY when pst_exempt is true. Free text: "PST exempt — resale certificate on file". No schema and no validation, because the seller is the one who has to defend it.';

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect: five columns, pst_exempt NOT NULL DEFAULT false, the rest nullable.

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN ('tax_kind', 'tax_label', 'tax_rate_percent', 'pst_exempt', 'pst_exemption_note')
ORDER BY column_name;

-- Expect 3 rows.
SELECT conname FROM pg_constraint
WHERE conname IN ('orders_tax_kind_check', 'orders_tax_rate_check', 'orders_tax_snapshot_whole');

-- Expect: every order has pst_exempt = false and NO snapshot. Nothing was
-- backfilled, so every existing document still renders through the live
-- fallback, exactly as it did before this ran.
SELECT count(*)                                   AS orders_total,
       count(*) FILTER (WHERE pst_exempt)         AS claiming_exemption,
       count(*) FILTER (WHERE tax_label IS NOT NULL) AS with_snapshot
FROM orders;

-- TG jewellers specifically — expect 15 orders, 3 with a delivery province
-- (AB, AB, BC) and 0 with a snapshot. Those three keep rendering at the live
-- rate until she picks one.
SELECT delivery_province, tax_kind, tax_label, tax_rate_percent, pst_exempt
FROM orders
WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
ORDER BY delivery_province NULLS LAST, created_at DESC;

-- Expect 0: tax_rates is untouched by all of this. It keeps its one job.
SELECT count(*) AS tax_rates_rows_changed FROM tax_rates WHERE false;
