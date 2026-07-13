-- ============================================================================
-- White Label Prepaid Billing — Phase 7: $97/mo platform subscription (per active client)
-- Run in the Supabase SQL editor (project bphpnlgjlklgwhewsnrm). Idempotent.
--
-- The PLATFORM subscription is a SEPARATE billing system from the usage wallet — charged to the
-- partner's card via ONE Stripe subscription with a dynamic quantity = active client count. It NEVER
-- touches partner_balances.balance_cents or the usage ledger. This migration adds the platform
-- subscription state onto partner_balances (reusing the existing platform_subscription_id /
-- platform_fee_status columns from Phase 1) and an append-only event history for reproducible reporting.
-- ============================================================================

-- 1) Platform status enum gains 'payment_required' — the terminal, gating state reached AFTER the grace
--    window on a failed invoice. 'past_due' now means "failed but still inside grace" (NOT gated).
ALTER TABLE partner_balances DROP CONSTRAINT IF EXISTS partner_balances_platform_fee_status_check;
ALTER TABLE partner_balances ADD CONSTRAINT partner_balances_platform_fee_status_check
  CHECK (platform_fee_status IN ('none','active','past_due','payment_required','canceled'));

-- 2) Platform subscription tracking (all default-safe; zero effect until WL_PLATFORM_FEE_ENABLED=true).
ALTER TABLE partner_balances ADD COLUMN IF NOT EXISTS platform_subscription_item_id text;   -- Stripe sub item (for quantity updates)
ALTER TABLE partner_balances ADD COLUMN IF NOT EXISTS platform_active_qty          int NOT NULL DEFAULT 0; -- last-synced billed quantity
ALTER TABLE partner_balances ADD COLUMN IF NOT EXISTS platform_current_period_end  timestamptz;           -- next invoice date
ALTER TABLE partner_balances ADD COLUMN IF NOT EXISTS platform_grace_until         timestamptz;           -- past_due → payment_required after this

-- 3) Append-only platform subscription history — the reproducible source of truth for platform revenue,
--    quantity changes, and dunning. Never updated or deleted. Deduped by idempotency_key (Stripe event
--    id / synthetic key) so a replayed webhook can't double-record.
CREATE TABLE IF NOT EXISTS platform_subscription_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id              uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  event_type              text NOT NULL CHECK (event_type IN (
                            'created','quantity_changed','invoice_paid','invoice_failed',
                            'grace_started','payment_required','restored','canceled')),
  quantity                int,               -- billed quantity at this event (active clients)
  amount_cents            bigint,            -- invoice amount (invoice_paid/failed), else null
  currency                text NOT NULL DEFAULT 'usd',
  previous_status         text,
  new_status              text,
  stripe_ref              text,              -- invoice / subscription id
  stripe_subscription_id  text,
  idempotency_key         text NOT NULL UNIQUE,
  metadata                jsonb,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pse_partner_created_idx ON platform_subscription_events (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pse_type_idx            ON platform_subscription_events (event_type);

-- RLS: server-only (service role), like the other billing tables. No partner/anon policies → locked.
ALTER TABLE platform_subscription_events ENABLE ROW LEVEL SECURITY;
