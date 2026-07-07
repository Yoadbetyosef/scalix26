-- Migration: Partner OS (4/5) — CRM + Demo generator
-- Partner-scoped sales CRM and the demo generator (public branded preview pages that reuse the
-- amy-realtime widget — no phone number provisioned per demo). Run in Supabase SQL Editor.

-- ============================================================
-- CRM LEADS (partner's sales pipeline)
-- ============================================================
CREATE TABLE IF NOT EXISTS crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- a partner_member
  business_name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  website text,
  industry text,
  stage text NOT NULL DEFAULT 'lead'
    CHECK (stage IN ('lead','qualified','demo_sent','trial','negotiation','won','lost','expansion','cancelled')),
  source text,
  tags text[] NOT NULL DEFAULT '{}',
  estimated_mrr_cents int,
  demo_id uuid,                        -- FK demos (added below)
  converted_tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_leads_partner_stage ON crm_leads(partner_id, stage);
CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned ON crm_leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_leads_tenant ON crm_leads(converted_tenant_id) WHERE converted_tenant_id IS NOT NULL;

-- ============================================================
-- CRM ACTIVITIES (timeline of every interaction)
-- ============================================================
CREATE TABLE IF NOT EXISTS crm_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES crm_leads(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('note','call','email','sms','stage_change','demo_sent','task')),
  body text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  due_at timestamptz,                  -- for tasks
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_activities_lead ON crm_activities(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_partner ON crm_activities(partner_id, created_at DESC);

-- ============================================================
-- DEMOS (public, shareable, branded interactive preview)
-- ============================================================
CREATE TABLE IF NOT EXISTS demos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES crm_leads(id) ON DELETE SET NULL,
  public_slug text UNIQUE NOT NULL,    -- /demo/[slug] (public, unauth)
  prospect_name text NOT NULL,
  website text,
  industry text,
  phone text,
  hours jsonb,
  faq jsonb,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,   -- logo/color for the branded preview
  briefing jsonb,                      -- precomputed prompt/context for the amy widget
  view_count int NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_demos_partner ON demos(partner_id, created_at DESC);

-- crm_leads.demo_id FK now that demos exists.
ALTER TABLE crm_leads
  DROP CONSTRAINT IF EXISTS crm_leads_demo_fk,
  ADD CONSTRAINT crm_leads_demo_fk FOREIGN KEY (demo_id) REFERENCES demos(id) ON DELETE SET NULL;

-- ============================================================
-- RLS — all partner-scoped.
-- ============================================================
ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE demos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Partner crm leads" ON crm_leads;
CREATE POLICY "Partner crm leads" ON crm_leads FOR ALL
  USING (partner_id = get_partner_id()) WITH CHECK (partner_id = get_partner_id());

DROP POLICY IF EXISTS "Partner crm activities" ON crm_activities;
CREATE POLICY "Partner crm activities" ON crm_activities FOR ALL
  USING (partner_id = get_partner_id()) WITH CHECK (partner_id = get_partner_id());

DROP POLICY IF EXISTS "Partner demos" ON demos;
CREATE POLICY "Partner demos" ON demos FOR ALL
  USING (partner_id = get_partner_id()) WITH CHECK (partner_id = get_partner_id());
-- Public read of a single demo is served server-side via the admin client (no anon policy needed).
