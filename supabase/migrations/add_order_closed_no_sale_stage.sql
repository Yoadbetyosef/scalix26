-- ============================================================================
-- A FOURTEENTH STAGE: closed_no_sale — the estimate the customer didn't take.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- CONSTRAINT ONLY. This widens what `orders.stage` may hold. There is no UPDATE
-- in this file: **no existing row changes stage, and no row is deleted.**
--
-- ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
--
-- TG jewellers writes ~30 estimates a day and a handful convert. The rest are
-- not cancelled work and not finished work: they are quotes the customer didn't
-- take, and the customer comes back. Every one has to stay in that customer's
-- history, and has to be able to come BACK to life when they do.
--
-- Today the only move available from 'new' is Cancel. Cancel does not delete
-- anything — the order, its line items, its timeline and its files all survive,
-- and this file changes none of that. What Cancel is, is FINAL:
-- canManualTransition refuses every move out of a terminal stage, so a
-- cancelled estimate can never be reopened. That is right for "this job is not
-- happening" and wrong for "not yet".
--
-- ── WHY A NEW WORD, GIVEN 'closed' WAS RETIRED ─────────────────────────────
--
-- add_order_closed_stage.sql added 'closed' and add_order_finished_stage.sql
-- took it away hours later, on the rule that two words for one state is the
-- thing worth avoiding. That rule is intact here and this does not violate it:
-- 'finished' means the job is OVER, 'closed_no_sale' means it never became a
-- job. They are different states, not two names for one, and an owner reading
-- a list can tell them apart without being told which is which.
--
-- The bare word 'closed' is still not used, and still should not be.
--
-- ── AND WHY IT IS NOT TERMINAL ─────────────────────────────────────────────
--
-- The other three terminal stages are one-way because the thing they describe
-- has happened. This one describes an absence, and an absence can end: the
-- customer walks back in. The code lets it move back to 'new' and nowhere else
-- — reopening restores the estimate exactly as it was, it does not advance it.
-- ============================================================================

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_stage_check;
ALTER TABLE orders ADD CONSTRAINT orders_stage_check
  CHECK (stage IN (
    'new',
    'waiting_factory_approval', 'factory_changes_requested', 'factory_approved',
    'waiting_customer_approval', 'customer_changes_requested', 'customer_approved',
    'production', 'ready', 'delivered',
    'completed',        -- produced and finished
    'finished',         -- finished, and saying nothing about production
    'closed_no_sale',   -- quoted, not taken. Reversible: the customer may return.
    'cancelled'
  ));

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect the constraint naming fourteen stages, with 'closed_no_sale' present
-- and the bare word 'closed' still absent.
SELECT pg_get_constraintdef(oid) AS orders_stage_check
FROM pg_constraint WHERE conname = 'orders_stage_check';

-- Expect 0. Nothing is moved into the new stage by this file.
SELECT count(*) AS already_closed_no_sale FROM orders WHERE stage = 'closed_no_sale';
