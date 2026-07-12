-- ============================================================================
-- White Label Prepaid Billing — Phase 2c: balance notice state (Phase 6 gating/notifications)
-- Run in the Supabase SQL editor (project bphpnlgjlklgwhewsnrm). Idempotent.
--
-- Adds partner_balances.balance_notice_state so the billing cron can fire a partner bell + email
-- exactly ONCE per crossing (none → low → paused) instead of every 1-2 minute tick. The gate
-- (lib/billing/gate.ts) reads the existing status/balance/platform_fee_status columns and needs no
-- new schema; this column only drives idempotent notifications (lib/billing/notify.ts).
--
--   'none'   — healthy, above the low-balance threshold
--   'low'    — below low_balance_threshold_cents but still funded (warning already sent)
--   'paused' — depleted / status paused (pause notice already sent)
-- Recovery downward updates the state silently (no "you're fine again" spam).
-- ============================================================================

ALTER TABLE partner_balances
  ADD COLUMN IF NOT EXISTS balance_notice_state text NOT NULL DEFAULT 'none';
