-- Migration: Partner OS (5/5) — Marketing, Learning, Marketplace, Notifications, Audit, Stats
-- Content tables are readable by any partner member (admin writes). Marketplace is opt-in public.
-- partner_stats is a nightly-computed dashboard cache (avoid live-aggregating the ledger).
-- Run in Supabase SQL Editor.

-- ============================================================
-- MARKETING CENTER (searchable, downloadable asset library)
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  category text NOT NULL,              -- logo|deck|script|template|one_pager|video|case_study|battle_card
  file_url text NOT NULL,
  thumbnail_url text,
  tags text[] NOT NULL DEFAULT '{}',
  min_partner_type text,               -- gate premium assets
  download_count int NOT NULL DEFAULT 0,
  search_tsv tsvector,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_assets_tsv ON marketing_assets USING GIN(search_tsv);
CREATE INDEX IF NOT EXISTS idx_marketing_assets_category ON marketing_assets(category) WHERE active;

CREATE OR REPLACE FUNCTION marketing_assets_tsv() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('english', coalesce(NEW.title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description,'')), 'B') ||
    setweight(to_tsvector('english', array_to_string(NEW.tags,' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.category,'')), 'C');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_marketing_assets_tsv ON marketing_assets;
CREATE TRIGGER trg_marketing_assets_tsv BEFORE INSERT OR UPDATE ON marketing_assets
  FOR EACH ROW EXECUTE FUNCTION marketing_assets_tsv();

-- ============================================================
-- LEARNING CENTER (academy: courses -> lessons, enrollments, certifications)
-- ============================================================
CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  sort int NOT NULL DEFAULT 0,
  cert_on_complete boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  video_url text,
  sort int NOT NULL DEFAULT 0,
  quiz jsonb                            -- [{q, options[], answer_index}]
);
CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(course_id, sort);

CREATE TABLE IF NOT EXISTS enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {lesson_id: completed_at}
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_partner ON enrollments(partner_id);

CREATE TABLE IF NOT EXISTS certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid REFERENCES courses(id) ON DELETE SET NULL,
  score int,
  badge text,
  certificate_url text,
  issued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_certifications_partner ON certifications(partner_id);

-- ============================================================
-- MARKETPLACE (public directory of certified partners + moderated reviews)
-- ============================================================
CREATE TABLE IF NOT EXISTS marketplace_profiles (
  partner_id uuid PRIMARY KEY REFERENCES partners(id) ON DELETE CASCADE,
  headline text,
  bio text,
  specialties text[] NOT NULL DEFAULT '{}',
  regions text[] NOT NULL DEFAULT '{}',
  languages text[] NOT NULL DEFAULT '{}',
  logo_url text,
  website text,
  listed boolean NOT NULL DEFAULT false,
  rating_avg numeric(3,2),
  review_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_listed ON marketplace_profiles(listed) WHERE listed;

CREATE TABLE IF NOT EXISTS marketplace_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  author_tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_reviews_partner ON marketplace_reviews(partner_id, status);

-- ============================================================
-- NOTIFICATIONS + AUDIT + STATS CACHE
-- ============================================================
CREATE TABLE IF NOT EXISTS partner_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- null = whole org
  kind text NOT NULL,                  -- new_customer|commission_earned|payout_sent|demo_viewed|cert_earned|new_lead
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_notifs ON partner_notifications(partner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS partner_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES partners(id) ON DELETE SET NULL,
  actor text NOT NULL,                 -- user email, 'system', or 'admin:<email>'
  action text NOT NULL,
  target_type text,
  target_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_audit_partner ON partner_audit_log(partner_id, created_at DESC);

-- Nightly-computed dashboard cache (one row per partner).
CREATE TABLE IF NOT EXISTS partner_stats (
  partner_id uuid PRIMARY KEY REFERENCES partners(id) ON DELETE CASCADE,
  mrr_generated_cents bigint NOT NULL DEFAULT 0,
  active_customers int NOT NULL DEFAULT 0,
  total_customers int NOT NULL DEFAULT 0,
  new_customers_30d int NOT NULL DEFAULT 0,
  trial_customers int NOT NULL DEFAULT 0,
  churned_customers int NOT NULL DEFAULT 0,
  conversion_rate numeric(5,2),
  pending_commission_cents bigint NOT NULL DEFAULT 0,
  paid_commission_cents bigint NOT NULL DEFAULT 0,
  lifetime_earnings_cents bigint NOT NULL DEFAULT 0,
  health_score int,
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE marketing_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_stats ENABLE ROW LEVEL SECURITY;

-- Content: readable by any authenticated partner member; admin writes bypass RLS.
DROP POLICY IF EXISTS "Marketing assets read" ON marketing_assets;
CREATE POLICY "Marketing assets read" ON marketing_assets FOR SELECT USING (get_partner_id() IS NOT NULL AND active);
DROP POLICY IF EXISTS "Courses read" ON courses;
CREATE POLICY "Courses read" ON courses FOR SELECT USING (get_partner_id() IS NOT NULL AND active);
DROP POLICY IF EXISTS "Lessons read" ON lessons;
CREATE POLICY "Lessons read" ON lessons FOR SELECT USING (get_partner_id() IS NOT NULL);

-- Own learning progress.
DROP POLICY IF EXISTS "Own enrollments" ON enrollments;
CREATE POLICY "Own enrollments" ON enrollments FOR ALL
  USING (partner_id = get_partner_id() AND user_id = auth.uid())
  WITH CHECK (partner_id = get_partner_id() AND user_id = auth.uid());
DROP POLICY IF EXISTS "Own certifications" ON certifications;
CREATE POLICY "Own certifications" ON certifications FOR SELECT USING (partner_id = get_partner_id());

-- Marketplace: public directory (anon may read listed profiles + published reviews).
DROP POLICY IF EXISTS "Marketplace public read" ON marketplace_profiles;
CREATE POLICY "Marketplace public read" ON marketplace_profiles FOR SELECT USING (listed OR partner_id = get_partner_id());
DROP POLICY IF EXISTS "Marketplace self update" ON marketplace_profiles;
CREATE POLICY "Marketplace self update" ON marketplace_profiles FOR ALL
  USING (partner_id = get_partner_id() AND partner_member_role() IN ('owner','manager','marketing'))
  WITH CHECK (partner_id = get_partner_id() AND partner_member_role() IN ('owner','manager','marketing'));
DROP POLICY IF EXISTS "Reviews public read" ON marketplace_reviews;
CREATE POLICY "Reviews public read" ON marketplace_reviews FOR SELECT
  USING (status = 'published' OR partner_id = get_partner_id());
DROP POLICY IF EXISTS "Reviews author insert" ON marketplace_reviews;
CREATE POLICY "Reviews author insert" ON marketplace_reviews FOR INSERT
  WITH CHECK (author_tenant_id = get_tenant_id());

-- Notifications + audit + stats: partner-scoped read.
DROP POLICY IF EXISTS "Partner notifications" ON partner_notifications;
CREATE POLICY "Partner notifications" ON partner_notifications FOR ALL
  USING (partner_id = get_partner_id()) WITH CHECK (partner_id = get_partner_id());
DROP POLICY IF EXISTS "Partner audit read" ON partner_audit_log;
CREATE POLICY "Partner audit read" ON partner_audit_log FOR SELECT
  USING (partner_id = get_partner_id() AND partner_member_role() IN ('owner','manager'));
DROP POLICY IF EXISTS "Partner stats read" ON partner_stats;
CREATE POLICY "Partner stats read" ON partner_stats FOR SELECT USING (partner_id = get_partner_id());

-- Anonymous read of listed marketplace profiles/published reviews for the public directory.
-- (Supabase 'anon' role: these SELECT policies already allow it since get_partner_id() is null
--  but `listed`/`status='published'` are true.)
