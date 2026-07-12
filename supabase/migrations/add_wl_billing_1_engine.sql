-- ============================================================================
-- White Label Prepaid Billing — Phase 1: pricing engine + wallet schema
-- Run in the Supabase SQL editor (project bphpnlgjlklgwhewsnrm). Idempotent.
--
-- Introduces the config-driven pricing engine + prepaid "Scalix Balance" wallet:
--   provider_rates          — the rate card (real provider unit costs; admin-editable, versioned)
--   billing_markup_config   — markup % (global default now; per-partner/enterprise/volume later)
--   partner_balances        — the wallet cache (one row per partner)
--   partner_balance_transactions — append-only ledger (source of truth; cache = Σ ledger)
--   apply_balance_txn()     — the ONE atomic, idempotent credit/debit primitive
--   usage_events (+cols)    — category + owning partner + priced flag for metering (Phase 2)
--   partners.provisioning_mode — seam for Enterprise BYO later
--
-- Partner-facing surfaces show CATEGORIES only. provider_cost_cents / provider live here for
-- ADMIN margin reporting and are never exposed to partners.
-- ============================================================================

-- ── Rate card ───────────────────────────────────────────────────────────────
-- unit_cost is REAL provider cost in USD per unit (numeric for token-level precision). Versioned
-- by effective_from so a rate change is a new row, never a rewrite. category is the partner-facing
-- bucket; provider is the internal/admin label.
CREATE TABLE IF NOT EXISTS provider_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category       text NOT NULL,                 -- 'voice' | 'messaging' | 'ai' | 'email' | 'storage' | 'other'
  provider       text NOT NULL,                 -- internal label, e.g. 'scalix_voice' (never shown to partners)
  metric         text NOT NULL,                 -- 'minute' | 'sms_segment' | 'input_token' | 'output_token' | 'email' | 'gb_month'
  unit_cost      numeric(20,10) NOT NULL,       -- REAL provider cost, USD per unit
  unit_type      text NOT NULL,                 -- human label for the metric unit
  currency       text NOT NULL DEFAULT 'usd',
  effective_from timestamptz NOT NULL DEFAULT now(),
  active         boolean NOT NULL DEFAULT true,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- One active rate per (provider, metric, currency) — the pricing engine reads the active row.
CREATE UNIQUE INDEX IF NOT EXISTS provider_rates_active_uniq
  ON provider_rates (provider, metric, currency) WHERE active;
CREATE INDEX IF NOT EXISTS provider_rates_category_idx ON provider_rates (category);

-- ── Markup config ─────────────────────────────────────────────────────────────
-- Resolution order (most specific wins): partner → enterprise → volume → global. Phase 1 ships the
-- global default (25%); the other scopes are additive later with zero engine change.
CREATE TABLE IF NOT EXISTS billing_markup_config (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope          text NOT NULL DEFAULT 'global'
                   CHECK (scope IN ('global','partner','enterprise','volume')),
  partner_id     uuid REFERENCES partners(id) ON DELETE CASCADE,  -- required when scope='partner'
  markup_pct     numeric(6,2) NOT NULL,          -- e.g. 25.00 = +25%
  currency       text NOT NULL DEFAULT 'usd',
  effective_from timestamptz NOT NULL DEFAULT now(),
  active         boolean NOT NULL DEFAULT true,
  updated_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_markup_global_uniq
  ON billing_markup_config (scope, currency) WHERE scope = 'global' AND active;
CREATE UNIQUE INDEX IF NOT EXISTS billing_markup_partner_uniq
  ON billing_markup_config (partner_id, currency) WHERE scope = 'partner' AND active;

-- ── Wallet cache (one per partner) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_balances (
  partner_id                  uuid PRIMARY KEY REFERENCES partners(id) ON DELETE CASCADE,
  balance_cents               bigint NOT NULL DEFAULT 0,      -- cache; authoritative value = Σ ledger. NEVER negative.
  currency                    text NOT NULL DEFAULT 'usd',
  status                      text NOT NULL DEFAULT 'active'  -- 'active' | 'paused' | 'payment_required'
                                CHECK (status IN ('active','paused','payment_required')),
  pending_charge_cents        bigint NOT NULL DEFAULT 0,      -- metered-but-undebited exposure (SEPARATE from balance)
  grace_cap_cents             bigint NOT NULL DEFAULT 0,      -- max exposure before pausing new usage (0 = strict)
  low_balance_threshold_cents bigint NOT NULL DEFAULT 10000,  -- $100 default warn line
  auto_reload_enabled         boolean NOT NULL DEFAULT false,
  auto_reload_threshold_cents bigint,                         -- reload when balance drops below this
  auto_reload_amount_cents    bigint,                         -- how much to add
  stripe_customer_id          text,                           -- PLATFORM customer (inbound top-ups; NOT the Express payout account)
  stripe_payment_method_id    text,                           -- saved card for off-session auto-reload
  last_auto_reload_at         timestamptz,
  auto_reload_pending         boolean NOT NULL DEFAULT false, -- guards once-per-threshold-cross
  platform_subscription_id    text,                           -- $97/mo per-active-client Stripe subscription (Phase 7)
  platform_fee_status         text NOT NULL DEFAULT 'none'
                                CHECK (platform_fee_status IN ('none','active','past_due','canceled')),
  low_balance_notified_at     timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- ── Append-only ledger (source of truth) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_balance_transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id          uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  type                text NOT NULL
                        CHECK (type IN ('top_up','usage','auto_reload','platform_fee','adjustment','refund','chargeback')),
  category            text,                        -- partner-facing bucket (voice/messaging/ai/email/storage/other)
  amount_cents        bigint NOT NULL,             -- SIGNED: positive = credit, negative = debit
  currency            text NOT NULL DEFAULT 'usd',
  -- Admin-only margin fields (never surfaced to partners):
  provider_cost_cents bigint,
  markup_pct          numeric(6,2),
  partner_charge_cents bigint,
  provider            text,
  tax_cents           bigint,                      -- seam for future tax support
  usage_event_id      uuid REFERENCES usage_events(id) ON DELETE SET NULL,
  stripe_ref          text,                        -- checkout session / payment intent / invoice id
  idempotency_key     text NOT NULL UNIQUE,        -- the dedupe guard (one apply per key)
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pbt_partner_created_idx ON partner_balance_transactions (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pbt_partner_type_idx    ON partner_balance_transactions (partner_id, type);
CREATE INDEX IF NOT EXISTS pbt_category_idx        ON partner_balance_transactions (category);

-- ── usage_events extensions (metering wiring lands in Phase 2) ─────────────────
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS category text;              -- partner-facing bucket
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE SET NULL; -- owning WL partner, else NULL
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS priced boolean NOT NULL DEFAULT false;  -- billing cron sets true after deduction
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS partner_charge_cents bigint;             -- what the partner was charged (post-markup)
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS idempotency_key text;                    -- optional per-usage dedupe
CREATE UNIQUE INDEX IF NOT EXISTS usage_events_idem_uniq ON usage_events (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Fast scan for the billing cron: unpriced usage owned by a partner.
CREATE INDEX IF NOT EXISTS usage_events_unpriced_partner_idx ON usage_events (partner_id, priced) WHERE partner_id IS NOT NULL AND priced = false;

-- ── Enterprise-BYO seam ───────────────────────────────────────────────────────
ALTER TABLE partners ADD COLUMN IF NOT EXISTS provisioning_mode text NOT NULL DEFAULT 'scalix_managed'
  CHECK (provisioning_mode IN ('scalix_managed','byo'));

-- ── THE atomic, idempotent, BALANCE-SAFE credit/debit primitive ───────────────
-- Credits always apply. Debits row-lock the wallet, verify sufficiency, and are REJECTED if they
-- would go below zero (Scalix never finances usage). Concurrent debits serialize on the lock.
-- Full definition + the separate pending-exposure model live in add_wl_billing_1b_safety.sql;
-- this file carries the same balance-safe version so a fresh install is correct on its own.
CREATE OR REPLACE FUNCTION apply_balance_txn(
  p_partner_id           uuid,
  p_type                 text,
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
    partner_id, type, amount_cents, category, currency, provider_cost_cents,
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

-- Server-only: callable by the service role (admin client) only, never anon/authenticated.
REVOKE ALL ON FUNCTION apply_balance_txn(uuid,text,bigint,text,text,text,bigint,numeric,bigint,text,uuid,text) FROM PUBLIC, anon, authenticated;

-- ── RLS: all four tables are server-only (app writes via admin client; partners/admin read via APIs)
ALTER TABLE provider_rates                ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_markup_config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_balances              ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_balance_transactions  ENABLE ROW LEVEL SECURITY;

-- ── Seed: markup default + rate card (real provider costs from lib/cost/rates.ts) ─────────────
INSERT INTO billing_markup_config (scope, markup_pct, currency)
SELECT 'global', 25.00, 'usd'
WHERE NOT EXISTS (SELECT 1 FROM billing_markup_config WHERE scope='global' AND currency='usd' AND active);

-- Rate card seed. ON CONFLICT keeps re-runs idempotent (active unique index on provider+metric+currency).
INSERT INTO provider_rates (category, provider, metric, unit_cost, unit_type, notes) VALUES
  ('messaging','scalix_messaging','sms_segment', 0.0083,      'segment', 'Twilio US SMS per segment'),
  ('voice',    'scalix_voice',    'minute',      0.0945,      'minute',  'Blended: Twilio voice 0.0085 + Deepgram 0.075 + voice-LLM 0.011'),
  ('ai',       'scalix_ai',       'input_token', 0.0000010,   'token',   'Claude Haiku 4.5 input ($1.00/1M)'),
  ('ai',       'scalix_ai',       'output_token',0.0000050,   'token',   'Claude Haiku 4.5 output ($5.00/1M)'),
  ('email',    'scalix_email',    'email',       0.0010,      'email',   'Transactional email per message (placeholder)'),
  ('storage',  'scalix_storage',  'gb_month',    0.0210,      'gb_month','Object storage per GB-month (placeholder)')
ON CONFLICT (provider, metric, currency) WHERE active DO NOTHING;

-- ============================================================================
-- Verify:
--   SELECT category, provider, metric, unit_cost, unit_type FROM provider_rates ORDER BY category;
--   SELECT scope, markup_pct FROM billing_markup_config WHERE active;
--   SELECT apply_balance_txn('<partner_uuid>','top_up',25000,'seed-test-1');  -- returns balance_cents=25000
--   SELECT apply_balance_txn('<partner_uuid>','top_up',25000,'seed-test-1');  -- duplicate=true, unchanged
-- ============================================================================
