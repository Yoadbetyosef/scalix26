-- ============================================================================
-- TG JEWELLERS, ROUND 2 — one file, five independent parts.
-- Run in the Supabase SQL editor. Every part is idempotent and safe to re-run.
--
-- ── RUN THE PARTS ONE AT A TIME, IN ORDER ──────────────────────────────────
--
-- Paste and run PART 1, read its verify output, then PART 2, and so on. The
-- last hand-run migration in this project was pasted whole, hit an error in a
-- later statement, and rolled the whole transaction back **silently** — the
-- editor reported the failure but the earlier parts had also vanished, and the
-- app then behaved as though a migration that "ran" had not. Five separate
-- runs cost a minute and cannot do that: each part stands alone and nothing
-- below depends on anything above.
--
-- ── DO NOT RUN add_order_closed_no_sale_stage.sql ──────────────────────────
--
-- PART 1 REPLACES it. That file is still in the repository, was never run, and
-- lists fourteen stages; running it after this one would DROP 'pending' back
-- out of the constraint and break the new board column. Part 1 below is a
-- superset of it.
--
-- ── WHAT NEEDS A BACKFILL, AND WHAT DELIBERATELY DOES NOT ──────────────────
--
-- Only PART 5, and only because a bug wrote bad data. Everything else is
-- additive: the application reads the new columns off the row and falls back to
-- what is already there, so an unmigrated database renders exactly as it does
-- today and a migrated one starts recording more. Specifically —
--
--   side_stone_shapes  empty array falls back to the existing side_stone_shape,
--                      so every line already saved keeps showing its shape.
--   deadline_on        null falls back to the old expires_at, which IS the date
--                      the recipient was originally given.
--   band_width_mm      null means "not recorded". Nothing is parsed out of
--                      `measurements`, which holds stone dimensions, lengths AND
--                      widths as free text — see lib/orders/product-types.ts.
--                      A guessed measurement on a manufacturing document is
--                      worse than an absent one.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- PART 1 — TWO MORE STAGES: 'closed_no_sale' and 'pending'
--
-- THIS IS THE FIX FOR "Close and No sale don't work".
--
-- Nothing was ever wrong with that code. `closed_no_sale` shipped complete in
-- db120a6 and its migration was never run, so every press hit this CHECK
-- constraint, came back 23514, and the owner got an error naming a file. The
-- button was fine; the database had not been told the word.
--
-- 'pending' is new: a job that is parked — waiting on a stone, a size, a
-- customer on holiday. Before it, such a job could only sit in 'new' (a lie
-- about it being untouched) or 'closed_no_sale' (a lie about losing it).
--
-- CONSTRAINT ONLY. No UPDATE: no existing row changes stage, none is deleted.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_stage_check;
ALTER TABLE orders ADD CONSTRAINT orders_stage_check
  CHECK (stage IN (
    'new',
    'pending',          -- parked: waiting on something, not lost and not idle
    'waiting_factory_approval', 'factory_changes_requested', 'factory_approved',
    'waiting_customer_approval', 'customer_changes_requested', 'customer_approved',
    'production', 'ready', 'delivered',
    'completed',        -- produced and finished
    'finished',         -- finished, and saying nothing about production
    'closed_no_sale',   -- quoted, not taken. Reversible: the customer may return.
    'cancelled'
  ));

-- Verify: expect fifteen stages listed, including 'pending' and
-- 'closed_no_sale', and the bare word 'closed' still absent.
SELECT pg_get_constraintdef(oid) AS orders_stage_check
FROM pg_constraint WHERE conname = 'orders_stage_check';

-- Verify: expect 0 and 0. This file moves nothing into either stage.
SELECT
  count(*) FILTER (WHERE stage = 'pending')        AS now_pending,
  count(*) FILTER (WHERE stage = 'closed_no_sale') AS now_closed_no_sale
FROM orders;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 2 — SEVERAL SIDE SHAPES, AND A BAND WIDTH IN MILLIMETRES
--
-- side_stone_shapes: a ring can be round on the shoulders and baguette down the
-- sides. One column could say one of those, so the second shape went into Notes
-- — where the factory reads it as prose and the document never prints it as a
-- spec at all.
--
-- The existing `side_stone_shape` (singular) is KEPT and keeps being written
-- with the first entry of the array. That is what lets the approval page, the
-- AI's order lookups and any report still reading it go on working unchanged
-- rather than silently going blank on the day this runs.
--
-- band_width_mm: a number with a fixed unit, which is what lets the document
-- print it in the spec table beside the other measurements instead of buried in
-- a free-text field shared with stone dimensions and necklace lengths.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS side_stone_shapes text[] NOT NULL DEFAULT '{}';
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS band_width_mm     numeric(6,2);

-- A band wider than a hand is a typo, and a workshop reads a spec sheet
-- literally. The application caps this at 100 too; this is the backstop for
-- anything reaching the table another way.
ALTER TABLE order_line_items DROP CONSTRAINT IF EXISTS order_line_items_band_width_mm_check;
ALTER TABLE order_line_items ADD CONSTRAINT order_line_items_band_width_mm_check
  CHECK (band_width_mm IS NULL OR (band_width_mm >= 0 AND band_width_mm <= 100));

-- Verify: expect two rows. side_stone_shapes NOT NULL defaulting to '{}',
-- band_width_mm nullable.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'order_line_items'
  AND column_name IN ('side_stone_shapes', 'band_width_mm')
ORDER BY column_name;

-- Verify: expect with_shapes = 0 and with_width = 0. NOT a backfill — every
-- existing line falls back to its single side_stone_shape when the array is
-- empty, so nothing needs moving and nothing is guessed.
SELECT
  count(*) FILTER (WHERE array_length(side_stone_shapes, 1) IS NOT NULL) AS with_shapes,
  count(*) FILTER (WHERE band_width_mm IS NOT NULL)                      AS with_width,
  count(*) FILTER (WHERE side_stone_shape IS NOT NULL)                   AS with_legacy_single,
  count(*)                                                                AS total
FROM order_line_items;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 3 — THE BUSINESS NAME ON AN ORDER
--
-- On the TG Designs side the customer IS the firm — a yacht centre, a dealer —
-- and the person is who to reach at it. One `customer_name` column could hold
-- one of those, which is why the live address book already contains "M&P Yacht
-- Centre" typed into a field meant for a human being.
--
-- `customer_name` KEEPS meaning the person in both cases: a retail buyer, or the
-- contact at the firm. So every surface that only knows customer_name still
-- shows something true, and the document composes the two.
--
-- Nullable, no default. Null is a retail order, which is most of them.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_company text;

-- Verify: expect one nullable row, and with_company = 0.
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'customer_company';

SELECT count(*) FILTER (WHERE customer_company IS NOT NULL) AS with_company, count(*) AS total
FROM orders;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 4 — A DEADLINE THAT IS ONLY A DEADLINE
--
-- The deadline used to be written into `expires_at`, where it doubled as a hard
-- kill switch on the token. It now has its own column and kills nothing.
--
-- `expires_at` is NOT dropped. Old rows carry values, the application reads
-- deadline_on and falls back to it, and that fallback is correct: for a row
-- written before today, expires_at IS the date the recipient was given. Dropping
-- the column would throw away the only record of what those people were told.
--
-- A DATE, not a timestamptz, and that is the point. The old value was an instant
-- computed as `<her local date> + 'T23:59:59Z'` — her calendar date stamped as a
-- UTC moment, which in Vancouver ends the day at 16:59 local. A deadline is a
-- day, not a moment; storing it as a day is what makes it impossible to get the
-- timezone wrong again.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE order_approval_requests ADD COLUMN IF NOT EXISTS deadline_on date;

-- Verify: expect one row, type `date`, nullable.
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_name = 'order_approval_requests' AND column_name = 'deadline_on';


-- ════════════════════════════════════════════════════════════════════════════
-- PART 5 — THE BACKFILL: BRING TG'S DEAD APPROVAL LINKS BACK
--
-- ── WHAT WENT WRONG, AS THE DATA RECORDS IT ────────────────────────────────
--
-- Two links sent 2026-09-09 at 01:26 and 01:27 UTC — 18:26 and 18:27 in
-- Vancouver — both with expires_at 2026-09-08T23:59:59Z. That instant is
-- 16:59:59 local: they were dead 87 minutes BEFORE they were sent. opened_at is
-- null on both, so her customer's first and only click got "Link unavailable".
--
-- Older rows show the same fault with a longer fuse: a link opened once on the
-- day it arrived, then expired overnight.
--
-- ── THE STATUS RESET IS THE PART THAT ACTUALLY REVIVES THEM ────────────────
--
-- The deployed code no longer reads expires_at at ALL, so clearing that column
-- changes no behaviour on its own. What kills a link now is `status = 'expired'`
-- — a value the reader used to write over whatever the row said, INCLUDING
-- 'approved'. So this restores the status and clears the column: the first
-- fixes the links, the second removes a value nothing should ever read again.
--
-- ── HOW A RESPONDED ROW GETS ITS ANSWER BACK ───────────────────────────────
--
-- The expiry overwrote real outcomes. A July factory approval reads as 'expired'
-- today and the only surviving record that it was approved is the order_events
-- row the response wrote. That log is the source of truth here — the decision is
-- read back out of it rather than guessed, and a row with no such event falls
-- back to 'opened' or 'sent' depending on whether anyone ever opened it.
--
-- ── SCOPE ──────────────────────────────────────────────────────────────────
--
-- TG jewellers only (e6f07ad7-…). Other tenants have rows that were expired by
-- the same bug and reviving them is a decision about THEIR customers, not one to
-- take inside a file about hers. To do it later, run the same statements with
-- the tenant_id line removed — but read the count in the first SELECT first.
-- ════════════════════════════════════════════════════════════════════════════

-- Look before you write. Expect the two 2026-09-09 rows and four older ones.
SELECT id, approval_type, status, sent_at, opened_at, responded_at, expires_at
FROM order_approval_requests
WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
  AND (status = 'expired' OR expires_at IS NOT NULL)
ORDER BY created_at DESC;

-- 5a. Restore the status the expiry overwrote.
UPDATE order_approval_requests r
SET status = COALESCE(
      -- What the recipient actually answered, from the timeline the response wrote.
      (SELECT e.payload->>'decision'
         FROM order_events e
        WHERE e.type = 'approval_responded'
          AND e.order_id = r.order_id
          AND e.actor    = r.approval_type
          AND e.payload->>'decision' IN ('approved', 'changes_requested', 'rejected')
        ORDER BY e.created_at DESC
        LIMIT 1),
      -- Never answered: back to where it was when the clock ran out.
      CASE WHEN r.opened_at IS NOT NULL THEN 'opened' ELSE 'sent' END
    ),
    updated_at = now()
WHERE r.tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
  AND r.status = 'expired';

-- 5b. Carry the date forward as a DEADLINE, then stop it being an expiry.
--     Only where no deadline is recorded yet, so re-running cannot overwrite one.
UPDATE order_approval_requests
SET deadline_on = COALESCE(deadline_on, (expires_at AT TIME ZONE 'UTC')::date)
WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
  AND expires_at IS NOT NULL;

UPDATE order_approval_requests
SET expires_at = NULL
WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
  AND expires_at IS NOT NULL;

-- Verify: expect NO row with status 'expired', NO row with expires_at set, and
-- the two links from 2026-09-09 sitting at 'sent' — live, openable, and ending
-- only when she withdraws them.
SELECT id, approval_type, status, sent_at, deadline_on, expires_at, revoked_at
FROM order_approval_requests
WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
ORDER BY created_at DESC;

-- Verify: expect still_expired = 0 and still_expiring = 0.
SELECT
  count(*) FILTER (WHERE status = 'expired')    AS still_expired,
  count(*) FILTER (WHERE expires_at IS NOT NULL) AS still_expiring
FROM order_approval_requests
WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f';
