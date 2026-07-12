-- ============================================================================
-- White Label Prepaid Billing — Phase 1b: BALANCE-SAFETY FIX
-- Run in the Supabase SQL editor (project bphpnlgjlklgwhewsnrm). Idempotent.
--
-- Fixes a production-blocking flaw: the naive apply_balance_txn let a debit push the balance
-- NEGATIVE (Scalix financing partner usage). Core rule now enforced at the primitive:
--   • Credits always apply.
--   • Debits are row-locked + balance-checked: a debit that would go below zero is REJECTED
--     (no ledger row, no balance change, status='payment_required', result='insufficient_balance').
--   • Concurrent debits serialize on the row lock → no double-spend of the same funds.
--   • Duplicate idempotency keys stay no-ops.
--
-- Delayed metering exposure is modeled SEPARATELY (never as a negative balance): pending_charge_cents
-- with a configurable grace_cap_cents, via accrue_pending_usage() which pauses at the cap.
-- ============================================================================

-- ── Separate exposure model + payment_required status ─────────────────────────
ALTER TABLE partner_balances ADD COLUMN IF NOT EXISTS pending_charge_cents bigint NOT NULL DEFAULT 0;
-- Max metered-but-undebited exposure tolerated before pausing new usage. 0 = no grace (strict).
ALTER TABLE partner_balances ADD COLUMN IF NOT EXISTS grace_cap_cents bigint NOT NULL DEFAULT 0;

ALTER TABLE partner_balances DROP CONSTRAINT IF EXISTS partner_balances_status_check;
ALTER TABLE partner_balances ADD CONSTRAINT partner_balances_status_check
  CHECK (status IN ('active','paused','payment_required'));

-- ── Balance-safe atomic credit/debit primitive (replaces the unsafe version) ──
CREATE OR REPLACE FUNCTION apply_balance_txn(
  p_partner_id           uuid,
  p_type                 text,
  p_amount_cents         bigint,     -- SIGNED: positive credit, negative debit
  p_idempotency_key      text,
  p_category             text     DEFAULT NULL,
  p_currency             text     DEFAULT 'usd',
  p_provider_cost_cents  bigint   DEFAULT NULL,
  p_markup_pct           numeric  DEFAULT NULL,
  p_partner_charge_cents bigint   DEFAULT NULL,
  p_provider             text     DEFAULT NULL,
  p_usage_event_id       uuid     DEFAULT NULL,
  p_stripe_ref           text     DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_balance  bigint;
  v_is_debit boolean := p_amount_cents < 0;
BEGIN
  -- Fast idempotency pre-check (the immutable ledger is the source of truth).
  IF EXISTS (SELECT 1 FROM partner_balance_transactions WHERE idempotency_key = p_idempotency_key) THEN
    SELECT balance_cents INTO v_balance FROM partner_balances WHERE partner_id = p_partner_id;
    RETURN jsonb_build_object('applied', false, 'duplicate', true, 'result', 'duplicate',
                              'balance_cents', COALESCE(v_balance, 0));
  END IF;

  -- Ensure the wallet exists, then LOCK the row for the rest of the txn. FOR UPDATE serializes
  -- concurrent debits so two callers can never both spend the same funds.
  INSERT INTO partner_balances (partner_id) VALUES (p_partner_id) ON CONFLICT (partner_id) DO NOTHING;
  SELECT balance_cents INTO v_balance FROM partner_balances WHERE partner_id = p_partner_id FOR UPDATE;

  -- Balance-safe debit: never below zero. Insufficient → reject WITHOUT inserting a completed debit
  -- and WITHOUT changing the balance. Scalix never finances usage.
  IF v_is_debit AND (v_balance + p_amount_cents < 0) THEN
    UPDATE partner_balances SET status = 'payment_required', updated_at = now()
     WHERE partner_id = p_partner_id;
    RETURN jsonb_build_object('applied', false, 'duplicate', false, 'result', 'insufficient_balance',
                              'balance_cents', v_balance, 'shortfall_cents', -(v_balance + p_amount_cents));
  END IF;

  -- Sufficient funds (or a credit): write the immutable ledger row FIRST (idempotency gate), then
  -- move the balance. A duplicate key raised here is caught below and never touches the balance.
  INSERT INTO partner_balance_transactions (
    partner_id, type, amount_cents, category, currency, provider_cost_cents,
    markup_pct, partner_charge_cents, provider, usage_event_id, stripe_ref, idempotency_key
  ) VALUES (
    p_partner_id, p_type, p_amount_cents, p_category, p_currency, p_provider_cost_cents,
    p_markup_pct, p_partner_charge_cents, p_provider, p_usage_event_id, p_stripe_ref, p_idempotency_key
  );

  UPDATE partner_balances
     SET balance_cents = v_balance + p_amount_cents,
         -- Restore service on any credit that leaves funds; pause exactly at zero.
         status = CASE WHEN v_balance + p_amount_cents <= 0 THEN 'paused' ELSE 'active' END,
         updated_at = now()
   WHERE partner_id = p_partner_id
   RETURNING balance_cents INTO v_balance;

  RETURN jsonb_build_object('applied', true, 'duplicate', false, 'result', 'applied', 'balance_cents', v_balance);
EXCEPTION WHEN unique_violation THEN
  SELECT balance_cents INTO v_balance FROM partner_balances WHERE partner_id = p_partner_id;
  RETURN jsonb_build_object('applied', false, 'duplicate', true, 'result', 'duplicate',
                            'balance_cents', COALESCE(v_balance, 0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION apply_balance_txn(uuid,text,bigint,text,text,text,bigint,numeric,bigint,text,uuid,text)
  FROM PUBLIC, anon, authenticated;

-- ── Separate delayed-metering exposure (never a negative prepaid balance) ──────
-- Accrue (or settle, with a negative delta) the metered-but-undebited exposure. Pauses new usage
-- once the balance is fully committed OR the grace cap is reached. Balance is NEVER touched here.
CREATE OR REPLACE FUNCTION accrue_pending_usage(
  p_partner_id   uuid,
  p_delta_cents  bigint
) RETURNS jsonb AS $$
DECLARE v_pending bigint; v_cap bigint; v_balance bigint;
BEGIN
  INSERT INTO partner_balances (partner_id) VALUES (p_partner_id) ON CONFLICT (partner_id) DO NOTHING;
  UPDATE partner_balances
     SET pending_charge_cents = GREATEST(0, pending_charge_cents + p_delta_cents),
         updated_at = now()
   WHERE partner_id = p_partner_id
   RETURNING pending_charge_cents, grace_cap_cents, balance_cents INTO v_pending, v_cap, v_balance;

  -- Exposure = committed balance minus in-flight pending. Pause when it hits zero, or the hard cap.
  IF (v_balance - v_pending) <= 0 OR (v_cap > 0 AND v_pending >= v_cap) THEN
    UPDATE partner_balances SET status = CASE WHEN status = 'active' THEN 'paused' ELSE status END
     WHERE partner_id = p_partner_id;
  END IF;

  RETURN jsonb_build_object(
    'pending_charge_cents', v_pending,
    'available_cents', v_balance - v_pending,
    'grace_cap_cents', v_cap,
    'exposure_exceeded', (v_balance - v_pending) <= 0 OR (v_cap > 0 AND v_pending >= v_cap)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION accrue_pending_usage(uuid,bigint) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- Verify (see the race + scenario script for the full suite):
--   SELECT apply_balance_txn('<p>','top_up', 5000,'t-credit');    -- applied, balance 5000
--   SELECT apply_balance_txn('<p>','usage', -6000,'t-over');       -- insufficient_balance, balance still 5000
--   SELECT apply_balance_txn('<p>','usage', -5000,'t-exact');      -- applied, balance 0, status 'paused'
-- ============================================================================
