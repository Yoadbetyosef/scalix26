-- Migration: Partner OS (1/5) — Identity plane
-- Partners are a SEPARATE actor plane from tenants. A single auth.users row can be both a
-- tenant owner AND a partner member; they resolve through different helpers (get_tenant_id
-- vs get_partner_id). Run in the Supabase SQL Editor. Idempotent.

-- ============================================================
-- PARTNERS (the distributor org)
-- ============================================================
CREATE TABLE IF NOT EXISTS partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_type text NOT NULL DEFAULT 'affiliate'
    CHECK (partner_type IN ('affiliate','growth','agency','enterprise','internal_rep')),
  company_name text,
  slug text UNIQUE NOT NULL,
  contact_email text NOT NULL,
  contact_phone text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending','active','suspended','banned')),
  tier int NOT NULL DEFAULT 1,
  default_commission_plan_id uuid,      -- FK added in migration 3 (commissions)
  health_score int,                     -- 0..100, recomputed nightly
  stripe_connect_express_id text,       -- SEPARATE from the tenant's Standard Connect account
  connect_payouts_enabled boolean NOT NULL DEFAULT false,
  connect_onboarding_complete boolean NOT NULL DEFAULT false,
  origin_tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL, -- viral-loop provenance
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partners_status ON partners(status);
CREATE INDEX IF NOT EXISTS idx_partners_type ON partners(partner_type);

-- Auto-generate a unique slug from company_name/contact_email on insert (mirrors set_tenant_slug).
CREATE OR REPLACE FUNCTION set_partner_slug() RETURNS trigger AS $$
DECLARE base text; candidate text; n int := 2;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN RETURN NEW; END IF;
  base := trim(both '-' from regexp_replace(
            regexp_replace(
              regexp_replace(lower(coalesce(NULLIF(NEW.company_name,''), split_part(NEW.contact_email,'@',1), 'partner')), '\s+', '-', 'g'),
              '[^a-z0-9-]', '', 'g'),
            '-+', '-', 'g'));
  IF base = '' THEN base := 'partner'; END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM partners WHERE slug = candidate) LOOP
    candidate := base || '-' || n; n := n + 1;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_set_partner_slug ON partners;
CREATE TRIGGER trg_set_partner_slug BEFORE INSERT ON partners
  FOR EACH ROW EXECUTE FUNCTION set_partner_slug();

-- ============================================================
-- PARTNER MEMBERS (users belonging to a partner org, with a team role)
-- ============================================================
CREATE TABLE IF NOT EXISTS partner_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner','manager','sales','marketing','finance','support')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
  invited_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, user_id)
);
-- One ACTIVE partner scope per user keeps get_partner_id() deterministic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_member_active_user
  ON partner_members(user_id) WHERE status = 'active' AND user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partner_members_partner ON partner_members(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_members_invited ON partner_members(lower(invited_email)) WHERE invited_email IS NOT NULL;

-- ============================================================
-- PARTNER API KEYS (API-first: programmatic access to /api/partner/*)
-- ============================================================
CREATE TABLE IF NOT EXISTS partner_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,             -- shown in UI, e.g. 'pk_live_ab12'
  key_hash text NOT NULL,               -- sha256 of the full key; raw shown once
  scopes text[] NOT NULL DEFAULT '{read}',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_api_key_hash ON partner_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_partner_api_keys_partner ON partner_api_keys(partner_id);

-- ============================================================
-- RLS HELPERS (mirror get_tenant_id)
-- ============================================================
-- The caller's active partner org (at most one active membership per user).
CREATE OR REPLACE FUNCTION get_partner_id()
RETURNS uuid AS $$
  SELECT partner_id FROM partner_members
  WHERE user_id = auth.uid() AND status = 'active'
  ORDER BY created_at ASC LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- The caller's team role in their active partner org.
CREATE OR REPLACE FUNCTION partner_member_role()
RETURNS text AS $$
  SELECT role FROM partner_members
  WHERE user_id = auth.uid() AND status = 'active'
  ORDER BY created_at ASC LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- ============================================================
-- RLS POLICIES
-- ============================================================
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_api_keys ENABLE ROW LEVEL SECURITY;

-- Partners: members can read their own org; updates by owner/manager. Inserts are service-role
-- (signup) — the admin client bypasses RLS.
DROP POLICY IF EXISTS "Partner self read" ON partners;
CREATE POLICY "Partner self read" ON partners FOR SELECT USING (id = get_partner_id());
DROP POLICY IF EXISTS "Partner self update" ON partners;
CREATE POLICY "Partner self update" ON partners FOR UPDATE
  USING (id = get_partner_id() AND partner_member_role() IN ('owner','manager','finance'));

-- Members: visible within the org; managed by owner/manager.
DROP POLICY IF EXISTS "Partner members read" ON partner_members;
CREATE POLICY "Partner members read" ON partner_members FOR SELECT USING (partner_id = get_partner_id());
DROP POLICY IF EXISTS "Partner members manage" ON partner_members;
CREATE POLICY "Partner members manage" ON partner_members FOR ALL
  USING (partner_id = get_partner_id() AND partner_member_role() IN ('owner','manager'))
  WITH CHECK (partner_id = get_partner_id() AND partner_member_role() IN ('owner','manager'));

-- API keys: owner/manager only.
DROP POLICY IF EXISTS "Partner api keys" ON partner_api_keys;
CREATE POLICY "Partner api keys" ON partner_api_keys FOR ALL
  USING (partner_id = get_partner_id() AND partner_member_role() IN ('owner','manager'))
  WITH CHECK (partner_id = get_partner_id() AND partner_member_role() IN ('owner','manager'));
