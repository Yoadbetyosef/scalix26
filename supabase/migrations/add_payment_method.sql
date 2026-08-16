-- ============================================================================
-- HOW THE MONEY ARRIVED.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Most businesses on this platform are paid by bank transfer, Zelle, cheque or
-- cash. Stripe is the exception, not the rule. `payment_allocations` records the
-- amount, the kind (charge/deposit/refund/adjustment) and a `provider_ref` — but
-- nothing anywhere says HOW it arrived, and "we received $100" without "by
-- transfer, ref 4471" is not something an owner can reconcile against a bank
-- statement or hand to an accountant.
--
-- `kind` does NOT answer it and must not be overloaded to: a deposit and a final
-- payment are both often bank transfers, and a Stripe charge and a cash charge
-- are both charges. Two orthogonal facts, two columns.
--
-- ── WHY THE RPC IS REPLACED RATHER THAN LEFT ALONE ─────────────────────────
--
-- The obvious cheaper option is to leave core_apply_payment untouched and stamp
-- the method onto the row afterwards, found by its idempotency key. That is a
-- second write outside the atomic one: a failure between them leaves a payment
-- with no method, and — worse — a RETRY would find the allocation already there,
-- return `idempotent: true`, and never write the method at all. The method would
-- be silently absent on precisely the rows that had trouble.
--
-- So the parameter goes into the function, and the whole thing stays one atomic,
-- idempotent write.
--
-- The body below is the SHIPPED function copied verbatim from
-- add_core_5_payments_inventory.sql. Two lines differ, both marked NEW. It is
-- restated rather than patched because Postgres has no way to add a parameter to
-- an existing function — the old signature is dropped and the new one created in
-- the same transaction, so there is no window in which no function exists.
-- ============================================================================

BEGIN;

ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS method text;

ALTER TABLE payment_allocations DROP CONSTRAINT IF EXISTS payment_allocations_method_check;
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_method_check
  CHECK (method IS NULL OR method IN ('transfer', 'zelle', 'cash', 'cheque', 'card', 'other'));

COMMENT ON COLUMN payment_allocations.method IS
  'How the money arrived: transfer | zelle | cash | cheque | card | other. NULL on rows recorded before this column existed — absent, not "other". Orthogonal to `kind`, which says what the money was FOR.';

-- ── The same function, with p_method ──────────────────────────────────────
--
-- The old 9-argument signature is dropped. lib/core/payments.ts is its only
-- caller and passes the new one; nothing else in the repository references it.

DROP FUNCTION IF EXISTS core_apply_payment(uuid, text, uuid, text, bigint, text, text, text, uuid);

CREATE OR REPLACE FUNCTION core_apply_payment(
  p_tenant uuid, p_doc_type text, p_doc_id uuid, p_kind text, p_amount_cents bigint,
  p_currency text, p_provider_ref text, p_key text, p_actor uuid,
  p_method text DEFAULT NULL                                          -- NEW
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_exists uuid; v_signed bigint; v_total bigint; v_paid bigint; v_balance bigint; v_status text;
BEGIN
  IF p_kind NOT IN ('charge','deposit','refund','adjustment') THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_kind'); END IF;
  -- NEW: refuse an unknown method here rather than at the CHECK, so the caller gets
  -- a shaped answer ('bad_method') instead of a raised exception mid-transaction.
  IF p_method IS NOT NULL AND p_method NOT IN ('transfer','zelle','cash','cheque','card','other') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_method');
  END IF;
  IF p_key IS NOT NULL THEN
    SELECT id INTO v_exists FROM payment_allocations WHERE tenant_id = p_tenant AND idempotency_key = p_key;
    IF v_exists IS NOT NULL THEN
      SELECT COALESCE(SUM(amount_cents),0) INTO v_paid FROM payment_allocations WHERE tenant_id = p_tenant AND document_type = p_doc_type AND document_id = p_doc_id;
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'paid_cents', v_paid);
    END IF;
  END IF;
  v_signed := CASE WHEN p_kind = 'refund' THEN -abs(p_amount_cents) ELSE abs(p_amount_cents) END;
  INSERT INTO payment_allocations (tenant_id, document_type, document_id, kind, amount_cents, currency, provider_ref, idempotency_key, created_by, method)
    VALUES (p_tenant, p_doc_type, p_doc_id, p_kind, v_signed, COALESCE(p_currency,'usd'), p_provider_ref, p_key, p_actor, p_method);   -- NEW: method

  SELECT COALESCE(SUM(amount_cents),0) INTO v_paid FROM payment_allocations WHERE tenant_id = p_tenant AND document_type = p_doc_type AND document_id = p_doc_id;
  -- document total (estimates/quotes/invoices share total_cents; orders use subtotal/balance snapshot)
  IF p_doc_type IN ('estimate','quote','invoice') THEN
    EXECUTE format('SELECT total_cents FROM %I WHERE id=$1 AND tenant_id=$2', p_doc_type||'s') INTO v_total USING p_doc_id, p_tenant;
  ELSE
    SELECT subtotal_cents INTO v_total FROM orders WHERE id = p_doc_id AND tenant_id = p_tenant;
  END IF;
  v_total := COALESCE(v_total, 0);
  v_balance := v_total - v_paid;
  v_status := CASE WHEN v_paid <= 0 THEN 'unpaid' WHEN v_paid >= v_total THEN 'paid' ELSE 'partial' END;
  IF v_paid < 0 THEN v_status := 'refunded'; END IF;
  RETURN jsonb_build_object('ok', true, 'total_cents', v_total, 'paid_cents', v_paid, 'balance_cents', v_balance, 'status', v_status);
END $$;

COMMIT;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect: the column, the constraint, and exactly ONE core_apply_payment with 10 args.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'payment_allocations' AND column_name = 'method';

SELECT conname FROM pg_constraint WHERE conname = 'payment_allocations_method_check';

SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'core_apply_payment';

-- Expect 1 row, method NULL: the existing $100 deposit predates this column.
SELECT id, amount_cents, kind, method FROM payment_allocations;
