-- Migration: Partner OS (3/5) — Commission engine
-- The ledger (commission_entries) is append-only and idempotent: every entry carries a
-- deterministic idempotency_key (unique index) so Stripe at-least-once webhook retries become
-- no-ops. Paid entries are never mutated; corrections are offsetting entries. All financial
-- writes are service-role/admin-only — partners get read-only. Run in Supabase SQL Editor.

-- ============================================================
-- COMMISSION PLANS (global default when partner_id IS NULL, else partner-specific)
-- ============================================================
CREATE TABLE IF NOT EXISTS commission_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES partners(id) ON DELETE CASCADE,   -- NULL = global/default
  name text NOT NULL,
  model text NOT NULL CHECK (model IN ('recurring_pct','one_time','tiered','hybrid')),
  recurring_pct numeric(5,2),          -- e.g. 20.00 = 20% of MRR
  one_time_cents int,                  -- bounty on first paid
  duration_months int,                 -- NULL = lifetime; else fixed-duration recurring
  tiers jsonb,                         -- [{"min_volume_cents":N,"pct":X}], by lifetime volume
  clawback_window_days int NOT NULL DEFAULT 60,
  currency text NOT NULL DEFAULT 'usd',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commission_plans_partner ON commission_plans(partner_id);

-- Seed a sensible global default plan (20% recurring, lifetime, $0 bounty) if none exists.
INSERT INTO commission_plans (partner_id, name, model, recurring_pct, duration_months)
SELECT NULL, 'Default — 20% recurring (lifetime)', 'recurring_pct', 20.00, NULL
WHERE NOT EXISTS (SELECT 1 FROM commission_plans WHERE partner_id IS NULL AND name = 'Default — 20% recurring (lifetime)');

-- Deferred FKs from earlier migrations now that commission_plans exists.
ALTER TABLE partners
  DROP CONSTRAINT IF EXISTS partners_default_commission_plan_fk,
  ADD CONSTRAINT partners_default_commission_plan_fk
    FOREIGN KEY (default_commission_plan_id) REFERENCES commission_plans(id) ON DELETE SET NULL;
ALTER TABLE referrals
  DROP CONSTRAINT IF EXISTS referrals_commission_plan_fk,
  ADD CONSTRAINT referrals_commission_plan_fk
    FOREIGN KEY (commission_plan_id) REFERENCES commission_plans(id) ON DELETE SET NULL;

-- ============================================================
-- BONUS CAMPAIGNS (signup bounties, sprints, volume bonuses)
-- ============================================================
CREATE TABLE IF NOT EXISTS bonus_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('signup_bounty','conversion_bounty','volume_bonus','sprint')),
  amount_cents int,
  threshold int,                       -- e.g. N conversions to earn
  starts_at timestamptz,
  ends_at timestamptz,
  partner_type text,                   -- optional eligibility filter
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- referral_links.campaign_id FK now that bonus_campaigns exists.
ALTER TABLE referral_links
  DROP CONSTRAINT IF EXISTS referral_links_campaign_fk,
  ADD CONSTRAINT referral_links_campaign_fk
    FOREIGN KEY (campaign_id) REFERENCES bonus_campaigns(id) ON DELETE SET NULL;

-- ============================================================
-- PAYOUTS (a batch of approved entries paid to a partner)
-- ============================================================
CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  amount_cents int NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  method text NOT NULL DEFAULT 'manual' CHECK (method IN ('manual','stripe_connect')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','processing','paid','failed')),
  period_start date,
  period_end date,
  stripe_transfer_id text,
  statement_url text,
  created_by text,                     -- admin email
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_payouts_partner ON payouts(partner_id, status);

-- ============================================================
-- COMMISSION ENTRIES — the ledger (append-only, idempotent)
-- ============================================================
CREATE TABLE IF NOT EXISTS commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  referral_id uuid REFERENCES referrals(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES commission_plans(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES bonus_campaigns(id) ON DELETE SET NULL,
  entry_type text NOT NULL
    CHECK (entry_type IN ('one_time','recurring','bonus','expansion','clawback','adjustment')),
  amount_cents int NOT NULL,           -- NEGATIVE for clawbacks/adjustments
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','paid','void')),
  source_event text,                   -- stripe event type
  source_ref text,                     -- stripe invoice/subscription id
  period_start date,
  period_end date,
  idempotency_key text NOT NULL,       -- deterministic; dedupes webhook retries
  payout_id uuid REFERENCES payouts(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  paid_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_idempotency ON commission_entries(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_commission_partner_status ON commission_entries(partner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_payout ON commission_entries(payout_id);
CREATE INDEX IF NOT EXISTS idx_commission_tenant ON commission_entries(tenant_id);

-- ============================================================
-- RLS — partners READ their own ledger/plans/payouts; ALL writes are service-role/admin.
-- ============================================================
ALTER TABLE commission_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE bonus_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Commission plans read" ON commission_plans;
CREATE POLICY "Commission plans read" ON commission_plans FOR SELECT
  USING (partner_id = get_partner_id() OR partner_id IS NULL);

DROP POLICY IF EXISTS "Bonus campaigns read" ON bonus_campaigns;
CREATE POLICY "Bonus campaigns read" ON bonus_campaigns FOR SELECT
  USING (get_partner_id() IS NOT NULL);

DROP POLICY IF EXISTS "Commission entries read" ON commission_entries;
CREATE POLICY "Commission entries read" ON commission_entries FOR SELECT
  USING (partner_id = get_partner_id());

DROP POLICY IF EXISTS "Payouts read" ON payouts;
CREATE POLICY "Payouts read" ON payouts FOR SELECT
  USING (partner_id = get_partner_id() AND partner_member_role() IN ('owner','manager','finance'));
