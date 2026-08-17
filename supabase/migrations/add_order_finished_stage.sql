-- ============================================================================
-- RENAME THE TERMINAL STAGE: closed → finished.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- add_order_closed_stage.sql added 'closed' a few hours ago. This replaces it
-- with 'finished' — the same stage, a better word. There is no period where
-- both are accepted, deliberately: two words for one state is the thing worth
-- avoiding, and a constraint that allows both would make it permanent the first
-- time somebody used the wrong one.
--
-- ── WHY THE RENAME IS FREE, AND WHY IT IS FREE ONLY NOW ────────────────────
--
-- Nothing is at 'closed'. Nobody has pressed the button on any tenant since it
-- shipped. The UPDATE below is therefore expected to move ZERO rows and exists
-- only so this is still correct if somebody closes an order between reading
-- this and running it.
--
-- Do this before that happens. Afterwards the same rename needs a data
-- migration, an order_events payload rewrite, and a conversation about what an
-- owner already saw on screen.
--
-- ── WHY NOT KEEP 'completed' AND DROP THE IDEA ─────────────────────────────
--
-- Unchanged from add_order_closed_stage.sql, and still the point: the manual
-- transitions run production → ready → delivered → completed, and thirteen of
-- the fifteen orders on TG jewellers' tenant sit at 'new', where the only move
-- is Cancel. 'completed' claims production. A repair, a stock sale, a piece the
-- customer collected did not go near a factory.
--
-- 'finished' says the job is over and claims nothing about how.
--
-- ── ONE NOTE FOR THE NEXT READER ───────────────────────────────────────────
--
-- lib/orders/finish.ts is a DIFFERENT idea and keeps its name: raiseInvoice and
-- addToCatalog, two independent timestamps for what you do WITH a finished job.
-- `stage = 'finished'` is where the job IS. They are adjacent in language and
-- unrelated in function, which is the one confusion this name buys.
-- ============================================================================

-- Expected to move 0 rows. See above.
UPDATE orders SET stage = 'finished' WHERE stage = 'closed';

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_stage_check;
ALTER TABLE orders ADD CONSTRAINT orders_stage_check
  CHECK (stage IN (
    'new',
    'waiting_factory_approval', 'factory_changes_requested', 'factory_approved',
    'waiting_customer_approval', 'customer_changes_requested', 'customer_approved',
    'production', 'ready', 'delivered',
    'completed',   -- produced and finished
    'finished',    -- finished, and saying nothing about production
    'cancelled'
  ));

-- Any stage_changed event that named the old word. Expected to touch 0 rows for
-- the same reason, but an event log that says a stage the constraint no longer
-- permits is a log nobody can read back.
UPDATE order_events
SET payload = jsonb_set(payload, '{to}', '"finished"')
WHERE type = 'stage_changed' AND payload ->> 'to' = 'closed';

UPDATE order_events
SET payload = jsonb_set(payload, '{from}', '"finished"')
WHERE type = 'stage_changed' AND payload ->> 'from' = 'closed';

COMMENT ON COLUMN orders.stage IS
  'Workflow stage. Three terminal values: completed (produced and finished), finished (over, with no claim about how — a repair, a stock sale, a piece that never went to a factory), cancelled. Approval stages are entered ONLY through the workflow actions, never by drag. NOT related to lib/orders/finish.ts, which is what you do WITH a finished job.';

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect the constraint naming thirteen stages, with 'finished' and no 'closed'.

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conname = 'orders_stage_check';

-- Expect 0 rows in both. If either returns anything, the UPDATEs above ran and
-- the rename was NOT free — say so rather than assuming it was.
SELECT count(*) AS still_closed FROM orders WHERE stage = 'closed';
SELECT count(*) AS events_naming_closed FROM order_events
WHERE type = 'stage_changed' AND (payload ->> 'to' = 'closed' OR payload ->> 'from' = 'closed');

-- The spread, unchanged apart from the rename. Nothing is migrated INTO
-- 'finished' — which orders are done is her judgement, one at a time.
SELECT stage, count(*) AS orders FROM orders GROUP BY stage ORDER BY count(*) DESC;
