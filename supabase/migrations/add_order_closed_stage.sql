-- ============================================================================
-- A JOB THAT IS DONE, WITH NO CLAIM ABOUT HOW.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- `orders.stage` carries a CHECK constraint listing the twelve stages from
-- add_orders_1.sql. Adding a thirteenth is a migration, not a code change — a
-- write of 'closed' against the current constraint fails with 23514.
--
-- ── WHY NOT 'completed' ────────────────────────────────────────────────────
--
-- Because the manual transitions only run production → ready → delivered →
-- completed, and eight of TG jewellers' fifteen orders sit at 'new'. From there
-- the single move available is Cancel. So the only way to say "this job is
-- finished" is to cancel it, or to walk a repair that never went near a factory
-- through factory approval and into production first.
--
-- Reusing 'completed' would fix the reachability and break the meaning: the
-- board would claim work was produced that was not. A repair, a stock sale, a
-- piece the customer collected — those are done, and 'completed' says something
-- about production that none of them did.
--
-- 'closed' says the job is over and makes NO claim about how it got there. That
-- is the whole reason for a separate stage rather than a looser transition
-- table.
--
-- ── TERMINAL, AND REACHABLE FROM ANYWHERE ──────────────────────────────────
--
-- Allowed from any non-terminal stage, including 'new'. It is terminal itself,
-- so nothing moves out of it — the same shape 'cancelled' already has, and for
-- the same reason: a closed job that can be dragged back into production is not
-- closed.
--
-- ── INVOICING STAYS INDEPENDENT ────────────────────────────────────────────
--
-- `invoiced_at` is a separate timestamp and stays one. finish.ts already says
-- why: "A job can be invoiced and not archived, archived and not invoiced, or
-- both — which is why they are two timestamps rather than one status." Closing
-- an order neither raises an invoice nor requires one, which is the distinction
-- she asked for.
-- ============================================================================

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_stage_check;
ALTER TABLE orders ADD CONSTRAINT orders_stage_check
  CHECK (stage IN (
    'new',
    'waiting_factory_approval', 'factory_changes_requested', 'factory_approved',
    'waiting_customer_approval', 'customer_changes_requested', 'customer_approved',
    'production', 'ready', 'delivered',
    'completed',   -- produced and finished
    'closed',      -- finished, and saying nothing about production
    'cancelled'
  ));

COMMENT ON COLUMN orders.stage IS
  'Workflow stage. Three terminal values: completed (produced and finished), closed (finished, no claim about how — a repair, a stock sale, a piece that never went to a factory), cancelled. Approval stages are entered ONLY through the workflow actions, never by drag.';

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect one row: the constraint, now naming thirteen stages including 'closed'.

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conname = 'orders_stage_check';

-- Expect the existing spread, unchanged — nothing is migrated INTO 'closed'.
-- Which orders are finished is her judgement, made one at a time, not a
-- guess this file makes on her behalf.
SELECT stage, count(*) AS orders
FROM orders GROUP BY stage ORDER BY count(*) DESC;

-- TG jewellers specifically. Expect 8 'new' — the ones that had no way to be
-- closed, and the reason this exists.
SELECT stage, count(*) AS orders
FROM orders WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
GROUP BY stage ORDER BY count(*) DESC;

-- Expect 0 everywhere: nothing is closed yet, on any tenant.
SELECT count(*) AS already_closed FROM orders WHERE stage = 'closed';
