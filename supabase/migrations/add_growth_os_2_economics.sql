-- Migration: Growth OS Sprint 2 — Economics Engine (event-sourced).
-- billing_events is the append-only source of truth; the processor turns events into
-- commission_entries, each stamped with source_event_id (full traceability). Tiers/deals/promotions/
-- upgrade-rules are all admin-editable config — no hardcoded economics. Idempotent. Run after growth_os_1.

-- ── 1. Billing event log (source of truth) ──
CREATE TABLE IF NOT EXISTS billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  partner_id uuid REFERENCES partners(id) ON DELETE SET NULL,     -- denormalized (attribution)
  referral_id uuid REFERENCES referrals(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'trial_started','converted_paid','renewed','plan_upgraded','plan_downgraded',
    'refunded','chargeback','cancelled','manual_adjustment')),
  amount_cents int NOT NULL DEFAULT 0,     -- gross customer amount for this event
  currency text NOT NULL DEFAULT 'usd',
  source text NOT NULL DEFAULT 'stripe' CHECK (source IN ('stripe','manual','system')),
  source_ref text,                          -- stripe invoice/charge/subscription id
  idempotency_key text NOT NULL,            -- dedupes Stripe retries
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  process_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_events_idem ON billing_events(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_billing_events_partner ON billing_events(partner_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_tenant ON billing_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_unprocessed ON billing_events(processed_at) WHERE processed_at IS NULL;

-- Every commission traces back to the event that produced it.
ALTER TABLE commission_entries ADD COLUMN IF NOT EXISTS source_event_id uuid REFERENCES billing_events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_commission_source_event ON commission_entries(source_event_id);

-- ── 2. Commission plans: wholesale / white-label / custom models + fee fields ──
ALTER TABLE commission_plans DROP CONSTRAINT IF EXISTS commission_plans_model_check;
ALTER TABLE commission_plans ADD CONSTRAINT commission_plans_model_check
  CHECK (model IN ('recurring_pct','one_time','tiered','hybrid','wholesale','white_label','custom'));
ALTER TABLE commission_plans ADD COLUMN IF NOT EXISTS wholesale_discount_pct numeric(5,2);
ALTER TABLE commission_plans ADD COLUMN IF NOT EXISTS platform_fee_cents int;
ALTER TABLE commission_plans ADD COLUMN IF NOT EXISTS setup_fee_cents int;
ALTER TABLE commission_plans ADD COLUMN IF NOT EXISTS payout_schedule text NOT NULL DEFAULT 'monthly';

-- ── 3. Per-partner deals (override the default) ──
CREATE TABLE IF NOT EXISTS partner_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  commission_plan_id uuid REFERENCES commission_plans(id) ON DELETE SET NULL,
  custom_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_deals_partner ON partner_deals(partner_id, active);

-- ── 4. Promotions (generalized bonus_campaigns): contests, seasonal, performance, one-time ──
ALTER TABLE bonus_campaigns DROP CONSTRAINT IF EXISTS bonus_campaigns_kind_check;
ALTER TABLE bonus_campaigns ADD CONSTRAINT bonus_campaigns_kind_check CHECK (kind IN (
  'signup_bounty','conversion_bounty','volume_bonus','sprint','one_time','contest','seasonal','performance'));
ALTER TABLE bonus_campaigns ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '{}'::jsonb;   -- {event_type, min_amount, metric, threshold, ...}
ALTER TABLE bonus_campaigns ADD COLUMN IF NOT EXISTS reward jsonb NOT NULL DEFAULT '{}'::jsonb;       -- {amount_cents | pct}
ALTER TABLE bonus_campaigns ADD COLUMN IF NOT EXISTS eligibility jsonb NOT NULL DEFAULT '{}'::jsonb;  -- {partner_types[], min_tier, ...}

-- ── 5. Upgrade rules (fully configurable; nothing hardcoded) ──
CREATE TABLE IF NOT EXISTS upgrade_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  metric text NOT NULL,                    -- active_customers | mrr_cents | xp | lifetime_earnings_cents
  threshold numeric NOT NULL,
  from_type text,                          -- optional: only partners of this type
  to_type text,                            -- suggest this type
  to_tier int,                             -- or set this tier
  action text NOT NULL CHECK (action IN ('notify','set_tier','suggest_type')),
  message text,
  active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── 6. Economics stats (dashboard cache) ──
ALTER TABLE partner_stats ADD COLUMN IF NOT EXISTS monthly_commission_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE partner_stats ADD COLUMN IF NOT EXISTS expansion_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE partner_stats ADD COLUMN IF NOT EXISTS churn_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE partner_stats ADD COLUMN IF NOT EXISTS portfolio_value_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE partner_stats ADD COLUMN IF NOT EXISTS projected_annual_cents bigint NOT NULL DEFAULT 0;

-- ── 7. Reseller billing (design-only tables for billing_mode='reseller'; engine built later) ──
CREATE TABLE IF NOT EXISTS reseller_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  period_start date, period_end date,
  amount_cents int NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','void')),
  stripe_invoice_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reseller_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES reseller_invoices(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  billing_event_id uuid REFERENCES billing_events(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  amount_cents int NOT NULL DEFAULT 0,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reseller_lines_invoice ON reseller_invoice_lines(invoice_id);

-- ── RLS ──
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE upgrade_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reseller_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE reseller_invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Billing events read" ON billing_events;
CREATE POLICY "Billing events read" ON billing_events FOR SELECT USING (partner_id = get_partner_id());
DROP POLICY IF EXISTS "Partner deals read" ON partner_deals;
CREATE POLICY "Partner deals read" ON partner_deals FOR SELECT USING (partner_id = get_partner_id());
DROP POLICY IF EXISTS "Upgrade rules read" ON upgrade_rules;
CREATE POLICY "Upgrade rules read" ON upgrade_rules FOR SELECT USING (get_partner_id() IS NOT NULL);
DROP POLICY IF EXISTS "Reseller invoices read" ON reseller_invoices;
CREATE POLICY "Reseller invoices read" ON reseller_invoices FOR SELECT USING (partner_id = get_partner_id() AND partner_member_role() IN ('owner','manager','finance'));
DROP POLICY IF EXISTS "Reseller lines read" ON reseller_invoice_lines;
CREATE POLICY "Reseller lines read" ON reseller_invoice_lines FOR SELECT USING (partner_id = get_partner_id() AND partner_member_role() IN ('owner','manager','finance'));

-- ── Seeds ──
-- The Growth ladder (30 → 40% by customer count), as the new active global default.
INSERT INTO commission_plans (partner_id, name, model, recurring_pct, duration_months, tiers, active)
SELECT NULL, 'Growth Ladder — 30–40% recurring (lifetime)', 'tiered', 30.00, NULL,
  '[{"min_customers":0,"pct":30},{"min_customers":11,"pct":32.5},{"min_customers":31,"pct":35},{"min_customers":76,"pct":37.5},{"min_customers":201,"pct":40}]'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM commission_plans WHERE partner_id IS NULL AND name = 'Growth Ladder — 30–40% recurring (lifetime)');
-- Retire the old flat 20% default so the ladder is picked as the global default going forward.
UPDATE commission_plans SET active = false WHERE partner_id IS NULL AND name = 'Default — 20% recurring (lifetime)';

-- Default upgrade nudges (editable in Admin).
INSERT INTO upgrade_rules (name, metric, threshold, to_type, action, message, sort)
SELECT * FROM (VALUES
  ('10 customers → Growth Partner', 'active_customers', 10, 'growth', 'suggest_type', 'You have 10 paying customers — unlock the full Growth Partner toolkit (CRM, demos, marketing).', 1),
  ('50 customers → Agency', 'active_customers', 50, 'agency', 'suggest_type', 'You are scaling fast. Agency mode adds a team, rep reporting, and agency commissions.', 2),
  ('100 customers → White Label', 'active_customers', 100, 'white_label', 'suggest_type', 'At 100+ customers, let''s talk White Label — your own brand, pricing, and wholesale economics.', 3)
) AS v(name, metric, threshold, to_type, action, message, sort)
WHERE NOT EXISTS (SELECT 1 FROM upgrade_rules WHERE name = v.name);
