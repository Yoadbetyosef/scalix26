-- ============================================================================
-- Internal cost on order lines.
--
-- ── THE PROBLEM ─────────────────────────────────────────────────────────────────────────────────────
--
-- A custom order records what the CUSTOMER pays and nothing about what it cost to make. `orders` has
-- exactly three money columns — subtotal_cents, deposit_cents, balance_cents — and `order_line_items`
-- has unit_price_cents and line_total_cents. There is nowhere for a cost to go, which is why entering one
-- appeared to "not save": it was never stored anywhere, and the deposit persisted because the deposit
-- is one of the three fields that exist.
--
-- ── WHY PER LINE, NOT PER ORDER ─────────────────────────────────────────────────────────────────────
--
-- An order can hold several pieces. A ring and a pendant on one order have their own costs, and a
-- single order-level figure cannot express that — it breaks on the second item, and it makes the
-- margin on any individual piece unknowable. Cost belongs where price already lives.
--
-- ── AND WHY NO STORED ORDER TOTAL ───────────────────────────────────────────────────────────────────
--
-- The order-level cost is the SUM of its lines and is derived at read time, never stored. A stored
-- total is a second copy of a number the lines already hold, and it goes wrong the first time a line
-- is edited without the rollup being recomputed. The same reasoning as balance_cents, which IS stored
-- — the difference is that balance is a commercial snapshot the customer agreed to, whereas cost is
-- an internal figure with no counterparty and no reason to be frozen.
--
-- ── VISIBILITY ──────────────────────────────────────────────────────────────────────────────────────
--
-- This column is INTERNAL. It must never reach a customer document, share link, approval page, email
-- or PDF. That is enforced in the application layer, where the customer-facing surfaces live, and
-- asserted by lib/orders/internal-cost.test.ts — which fails if any of those surfaces ever selects it.
--
-- Additive, idempotent, no backfill. Existing rows get 0, which is honest: their cost was never
-- recorded and 0 is not a claim that they were free — see the NULL note below.
-- ============================================================================

ALTER TABLE order_line_items
  ADD COLUMN IF NOT EXISTS internal_cost_cents bigint;

COMMENT ON COLUMN order_line_items.internal_cost_cents IS
  'INTERNAL ONLY — what this line cost the business to produce. Never rendered on any customer-facing surface. NULL means not recorded; 0 means genuinely free.';

-- NULLABLE, deliberately, with no default.
--
-- 0 and "not entered" are different facts, and a NOT NULL DEFAULT 0 would erase the difference on
-- every row that predates this column — making an order with no cost recorded indistinguishable from
-- one that cost nothing. The margin on the first is unknown; on the second it is 100%. The UI shows a
-- blank for NULL and a figure for 0, and the rollup skips NULLs rather than counting them as zero.

-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
--   ALTER TABLE order_line_items DROP COLUMN internal_cost_cents;
--
-- Dropping it destroys every cost the business has entered, and nothing else references it, so there
-- is no partial rollback: either the column is there or that data is gone.
