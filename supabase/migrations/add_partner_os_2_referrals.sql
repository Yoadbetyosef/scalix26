-- Migration: Partner OS (2/5) — Referral tracking & attribution
-- Attribution system-of-record is the `referrals` table. tenants gets ONE denormalized mirror
-- column (referred_by_partner_id) for fast joins + the self-referral guard. The click stream is
-- append-only and month-partitioned for scale (millions of clicks). Run in Supabase SQL Editor.

-- ============================================================
-- REFERRAL LINKS (a partner's trackable links)
-- ============================================================
CREATE TABLE IF NOT EXISTS referral_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  code text UNIQUE NOT NULL,            -- short, URL-safe; drives /r/[code]
  label text,                          -- "IG bio", "webinar Q3"
  campaign_id uuid,                    -- FK bonus_campaigns (migration 3, nullable)
  destination_path text NOT NULL DEFAULT '/auth/signup',
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  click_count bigint NOT NULL DEFAULT 0,   -- denormalized async counter
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_links_partner ON referral_links(partner_id, created_at DESC);

-- ============================================================
-- REFERRAL CLICKS — append-only, RANGE-partitioned by month.
-- Service-role writes only (the redirect endpoint). No partner read policy: raw clicks are PII;
-- partners only ever see server-side aggregates. A DEFAULT partition guarantees inserts always
-- land somewhere even if the month partition hasn't been pre-created yet.
-- ============================================================
CREATE TABLE IF NOT EXISTS referral_clicks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL,
  partner_id uuid NOT NULL,            -- denormalized so aggregation never joins
  visitor_id uuid NOT NULL,           -- first-party cookie id
  ip_hash text,                       -- hashed, for dedupe/fraud (never raw IP)
  user_agent text,
  referer text,
  utm jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS referral_clicks_default PARTITION OF referral_clicks DEFAULT;
-- Pre-create the current + next two months. A cron (or the M8 job) rolls new ones forward.
DO $$
DECLARE m date := date_trunc('month', now())::date; i int;
BEGIN
  FOR i IN 0..2 LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS referral_clicks_%s PARTITION OF referral_clicks FOR VALUES FROM (%L) TO (%L)',
      to_char(m + (i || ' month')::interval, 'YYYY_MM'),
      (m + (i || ' month')::interval)::date,
      (m + ((i+1) || ' month')::interval)::date
    );
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS idx_referral_clicks_visitor ON referral_clicks(visitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_link ON referral_clicks(link_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_clicks_partner ON referral_clicks(partner_id, created_at DESC);

-- ============================================================
-- REFERRALS — attribution system-of-record. One row per referred customer.
-- ============================================================
CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  first_touch_link_id uuid REFERENCES referral_links(id) ON DELETE SET NULL,
  last_touch_link_id uuid REFERENCES referral_links(id) ON DELETE SET NULL,
  first_touch_at timestamptz,
  last_touch_at timestamptz,
  visitor_id uuid,
  attributed_email text,
  status text NOT NULL DEFAULT 'signup'
    CHECK (status IN ('signup','trial','paid','churned','rejected')),
  commission_plan_id uuid,             -- snapshot of the plan at attribution time (FK migration 3)
  converted_at timestamptz,            -- trial -> paid moment
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)                   -- one attribution per customer
);
CREATE INDEX IF NOT EXISTS idx_referrals_partner ON referrals(partner_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_visitor ON referrals(visitor_id);

-- Atomic click counter (avoids read-modify-write contention on hot links).
CREATE OR REPLACE FUNCTION increment_referral_click(p_link_id uuid)
RETURNS void AS $$
  UPDATE referral_links SET click_count = click_count + 1 WHERE id = p_link_id;
$$ LANGUAGE SQL;

-- Denormalized last-touch pointer on the customer row (analytics + self-referral guard).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referred_by_partner_id uuid REFERENCES partners(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_referred_by ON tenants(referred_by_partner_id) WHERE referred_by_partner_id IS NOT NULL;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE referral_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_clicks ENABLE ROW LEVEL SECURITY;   -- no partner policy = service-role only
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Partner referral links" ON referral_links;
CREATE POLICY "Partner referral links" ON referral_links FOR ALL
  USING (partner_id = get_partner_id()) WITH CHECK (partner_id = get_partner_id());

-- Referrals are read-only to partners; all writes are service-role (attribution + webhook).
DROP POLICY IF EXISTS "Partner referrals read" ON referrals;
CREATE POLICY "Partner referrals read" ON referrals FOR SELECT USING (partner_id = get_partner_id());
