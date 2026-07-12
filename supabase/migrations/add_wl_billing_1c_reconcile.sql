-- ============================================================================
-- White Label Prepaid Billing — Phase 1c: normalized transaction_type + reconciliation
-- Run in the Supabase SQL editor (project bphpnlgjlklgwhewsnrm). Idempotent.
--
-- 1) Renames the ledger's `type` column to `transaction_type` — the normalized, enforced
--    classification every financial report reconciles against (still NOT NULL + CHECK).
-- 2) Recreates apply_balance_txn to write `transaction_type` (behavior unchanged, still balance-safe).
-- 3) Adds partner_ledger_reconciliation: proves cache balance == Σ ledger per partner (drift must be 0),
--    so admin can reconcile every dollar.
-- ============================================================================

-- ── 1) Normalize the column name (guarded so re-runs are no-ops) ──────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'partner_balance_transactions' AND column_name = 'type') THEN
    ALTER TABLE partner_balance_transactions RENAME COLUMN type TO transaction_type;
  END IF;
END $$;

-- ── 2) Recreate the primitive writing transaction_type (same balance-safe logic) ──
CREATE OR REPLACE FUNCTION apply_balance_txn(
  p_partner_id           uuid,
  p_type                 text,       -- the transaction_type VALUE (top_up/usage/auto_reload/…)
  p_amount_cents         bigint,
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
DECLARE v_balance bigint; v_is_debit boolean := p_amount_cents < 0;
BEGIN
  IF EXISTS (SELECT 1 FROM partner_balance_transactions WHERE idempotency_key = p_idempotency_key) THEN
    SELECT balance_cents INTO v_balance FROM partner_balances WHERE partner_id = p_partner_id;
    RETURN jsonb_build_object('applied', false, 'duplicate', true, 'result', 'duplicate', 'balance_cents', COALESCE(v_balance,0));
  END IF;

  INSERT INTO partner_balances (partner_id) VALUES (p_partner_id) ON CONFLICT (partner_id) DO NOTHING;
  SELECT balance_cents INTO v_balance FROM partner_balances WHERE partner_id = p_partner_id FOR UPDATE;

  IF v_is_debit AND (v_balance + p_amount_cents < 0) THEN
    UPDATE partner_balances SET status = 'payment_required', updated_at = now() WHERE partner_id = p_partner_id;
    RETURN jsonb_build_object('applied', false, 'duplicate', false, 'result', 'insufficient_balance',
                              'balance_cents', v_balance, 'shortfall_cents', -(v_balance + p_amount_cents));
  END IF;

  INSERT INTO partner_balance_transactions (
    partner_id, transaction_type, amount_cents, category, currency, provider_cost_cents,
    markup_pct, partner_charge_cents, provider, usage_event_id, stripe_ref, idempotency_key
  ) VALUES (
    p_partner_id, p_type, p_amount_cents, p_category, p_currency, p_provider_cost_cents,
    p_markup_pct, p_partner_charge_cents, p_provider, p_usage_event_id, p_stripe_ref, p_idempotency_key
  );

  UPDATE partner_balances
     SET balance_cents = v_balance + p_amount_cents,
         status = CASE WHEN v_balance + p_amount_cents <= 0 THEN 'paused' ELSE 'active' END,
         updated_at = now()
   WHERE partner_id = p_partner_id
   RETURNING balance_cents INTO v_balance;

  RETURN jsonb_build_object('applied', true, 'duplicate', false, 'result', 'applied', 'balance_cents', v_balance);
EXCEPTION WHEN unique_violation THEN
  SELECT balance_cents INTO v_balance FROM partner_balances WHERE partner_id = p_partner_id;
  RETURN jsonb_build_object('applied', false, 'duplicate', true, 'result', 'duplicate', 'balance_cents', COALESCE(v_balance,0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION apply_balance_txn(uuid,text,bigint,text,text,text,bigint,numeric,bigint,text,uuid,text)
  FROM PUBLIC, anon, authenticated;

-- ── 3) Reconciliation view: cache balance vs Σ ledger (drift must always be 0) ──
CREATE OR REPLACE VIEW partner_ledger_reconciliation AS
SELECT b.partner_id,
       b.balance_cents                                   AS cache_balance_cents,
       COALESCE(SUM(t.amount_cents), 0)::bigint          AS ledger_sum_cents,
       (b.balance_cents - COALESCE(SUM(t.amount_cents), 0))::bigint AS drift_cents,
       COUNT(t.id)                                       AS txn_count,
       b.pending_charge_cents,
       b.status
FROM partner_balances b
LEFT JOIN partner_balance_transactions t ON t.partner_id = b.partner_id
GROUP BY b.partner_id, b.balance_cents, b.pending_charge_cents, b.status;

-- ============================================================================
-- Verify:
--   SELECT * FROM partner_ledger_reconciliation WHERE drift_cents <> 0;   -- must return ZERO rows
--   SELECT transaction_type, count(*) FROM partner_balance_transactions GROUP BY 1;
-- ============================================================================
