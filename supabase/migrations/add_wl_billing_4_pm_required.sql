-- ============================================================================
-- White Label Prepaid Billing — Phase 7 hardening: "payment method required" state
-- Run in the Supabase SQL editor (project bphpnlgjlklgwhewsnrm). Idempotent. Additive only —
-- extends two CHECK constraints; touches no existing rows.
--
-- A White Label partner can have active clients (owes the $97/mo fee) but no saved card, so no Stripe
-- subscription can be created. Instead of the cron throwing every run, syncPlatformQuantity now records a
-- deterministic 'no_payment_method' event and flags the partner 'payment_method_required' (non-blocking —
-- the billing gate does NOT stop these partners; they simply see a prompt to add a card).
-- ============================================================================

-- 1) partner_balances.platform_fee_status gains 'payment_method_required'.
ALTER TABLE partner_balances DROP CONSTRAINT IF EXISTS partner_balances_platform_fee_status_check;
ALTER TABLE partner_balances ADD CONSTRAINT partner_balances_platform_fee_status_check
  CHECK (platform_fee_status IN ('none','active','past_due','payment_required','canceled','payment_method_required'));

-- 2) platform_subscription_events.event_type gains 'no_payment_method'.
ALTER TABLE platform_subscription_events DROP CONSTRAINT IF EXISTS platform_subscription_events_event_type_check;
ALTER TABLE platform_subscription_events ADD CONSTRAINT platform_subscription_events_event_type_check
  CHECK (event_type IN (
    'created','quantity_changed','invoice_paid','invoice_failed',
    'grace_started','payment_required','restored','canceled','no_payment_method'));
