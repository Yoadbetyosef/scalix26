-- Migration: Growth OS Sprint 3 — Marketing OS + attribution chain.
-- campaigns / creatives (official+private, lifecycle) / landing_pages / partner_spend + rollup
-- caches, and campaign_id/creative_id threaded through the funnel so every customer traces
-- creative → campaign → link → demo → paid → revenue → commission → ROI. Idempotent.

-- ── Campaigns ──
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name text NOT NULL,
  objective text,
  channel text,                       -- meta|google|tiktok|linkedin|organic|email|other
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','paused','archived')),
  budget_cents int,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_partner ON campaigns(partner_id, status);

-- ── Creatives (partner_id NULL = official Scalix library) ──
CREATE TABLE IF NOT EXISTS creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES partners(id) ON DELETE CASCADE,   -- NULL = official library
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('ad_copy','headline','video','image','landing_page','email','sms','call_script','follow_up_sequence')),
  title text NOT NULL,
  body text,
  asset_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','testing','winner','archived')),
  cloned_from_id uuid REFERENCES creatives(id) ON DELETE SET NULL,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_creatives_partner ON creatives(partner_id, status);
CREATE INDEX IF NOT EXISTS idx_creatives_official ON creatives(type) WHERE partner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_creatives_campaign ON creatives(campaign_id);

-- ── Landing pages (public /l/[slug]; CTA routes through a referral link) ──
CREATE TABLE IF NOT EXISTS landing_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  creative_id uuid REFERENCES creatives(id) ON DELETE SET NULL,
  referral_link_id uuid,              -- the link its CTA points to (attribution); FK added below
  slug text UNIQUE NOT NULL,
  headline text NOT NULL,
  subhead text,
  cta_text text NOT NULL DEFAULT 'Get started free',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  view_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_landing_partner ON landing_pages(partner_id, created_at DESC);

-- ── Ad spend (manual now; integration-ready) ──
CREATE TABLE IF NOT EXISTS partner_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  platform text NOT NULL DEFAULT 'other' CHECK (platform IN ('meta','google','tiktok','linkedin','other')),
  amount_cents int NOT NULL DEFAULT 0,
  spend_date date NOT NULL DEFAULT (now())::date,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','integration')),
  external_ref text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_spend_partner ON partner_spend(partner_id, spend_date DESC);
CREATE INDEX IF NOT EXISTS idx_partner_spend_campaign ON partner_spend(campaign_id);

-- ── Rollup caches (O(1) performance reads) ──
CREATE TABLE IF NOT EXISTS campaign_stats (
  campaign_id uuid PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL,
  clicks bigint NOT NULL DEFAULT 0,
  signups int NOT NULL DEFAULT 0,
  trials int NOT NULL DEFAULT 0,
  paid int NOT NULL DEFAULT 0,
  revenue_cents bigint NOT NULL DEFAULT 0,       -- gross customer revenue attributed
  commission_cents bigint NOT NULL DEFAULT 0,
  spend_cents bigint NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS creative_stats (
  creative_id uuid PRIMARY KEY REFERENCES creatives(id) ON DELETE CASCADE,
  partner_id uuid,
  clicks bigint NOT NULL DEFAULT 0,
  demos int NOT NULL DEFAULT 0,
  signups int NOT NULL DEFAULT 0,
  paid int NOT NULL DEFAULT 0,
  commission_cents bigint NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- ── Thread campaign_id + creative_id through the funnel ──
-- referral_links.campaign_id currently FKs bonus_campaigns but is unused by promotion logic —
-- repoint it to marketing campaigns (all existing values are NULL, so this is safe).
ALTER TABLE referral_links DROP CONSTRAINT IF EXISTS referral_links_campaign_fk;
ALTER TABLE referral_links
  ADD CONSTRAINT referral_links_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE referral_links ADD COLUMN IF NOT EXISTS creative_id uuid REFERENCES creatives(id) ON DELETE SET NULL;
ALTER TABLE referral_links ADD COLUMN IF NOT EXISTS landing_page_id uuid REFERENCES landing_pages(id) ON DELETE SET NULL;

ALTER TABLE landing_pages
  ADD CONSTRAINT landing_pages_referral_link_fk FOREIGN KEY (referral_link_id) REFERENCES referral_links(id) ON DELETE SET NULL;

ALTER TABLE referral_clicks ADD COLUMN IF NOT EXISTS campaign_id uuid;   -- denormalized (append-only, logical FK)
ALTER TABLE referral_clicks ADD COLUMN IF NOT EXISTS creative_id uuid;

ALTER TABLE demos ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE demos ADD COLUMN IF NOT EXISTS creative_id uuid REFERENCES creatives(id) ON DELETE SET NULL;

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS creative_id uuid REFERENCES creatives(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_campaign ON referrals(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_creative ON referrals(creative_id) WHERE creative_id IS NOT NULL;

-- ── RLS ──
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE landing_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_spend ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Partner campaigns" ON campaigns;
CREATE POLICY "Partner campaigns" ON campaigns FOR ALL USING (partner_id = get_partner_id()) WITH CHECK (partner_id = get_partner_id());
-- Creatives: partner sees own + the official library (partner_id IS NULL); writes only own.
DROP POLICY IF EXISTS "Creatives read" ON creatives;
CREATE POLICY "Creatives read" ON creatives FOR SELECT USING (partner_id = get_partner_id() OR partner_id IS NULL);
DROP POLICY IF EXISTS "Creatives write" ON creatives;
CREATE POLICY "Creatives write" ON creatives FOR ALL USING (partner_id = get_partner_id()) WITH CHECK (partner_id = get_partner_id());
DROP POLICY IF EXISTS "Partner landing pages" ON landing_pages;
CREATE POLICY "Partner landing pages" ON landing_pages FOR ALL USING (partner_id = get_partner_id()) WITH CHECK (partner_id = get_partner_id());
DROP POLICY IF EXISTS "Partner spend" ON partner_spend;
CREATE POLICY "Partner spend" ON partner_spend FOR ALL USING (partner_id = get_partner_id()) WITH CHECK (partner_id = get_partner_id());
DROP POLICY IF EXISTS "Campaign stats read" ON campaign_stats;
CREATE POLICY "Campaign stats read" ON campaign_stats FOR SELECT USING (partner_id = get_partner_id());
DROP POLICY IF EXISTS "Creative stats read" ON creative_stats;
CREATE POLICY "Creative stats read" ON creative_stats FOR SELECT USING (partner_id = get_partner_id());
