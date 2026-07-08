-- Migration: Partner OS V3 (9) — Scalix sales pipeline stages + demo analytics.
-- Remaps CRM stages to the V3 funnel and adds a demo_views table (unique visitors + dwell time).
-- Idempotent. Run after 1–8.

-- ── New pipeline stages ──
ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS crm_leads_stage_check;
UPDATE crm_leads SET stage = 'demo_generated' WHERE stage = 'demo_sent';
UPDATE crm_leads SET stage = 'paid' WHERE stage = 'won';
UPDATE crm_leads SET stage = 'lost' WHERE stage = 'cancelled';
UPDATE crm_leads SET stage = 'trial' WHERE stage = 'negotiation';
ALTER TABLE crm_leads ADD CONSTRAINT crm_leads_stage_check
  CHECK (stage IN ('lead','qualified','demo_generated','demo_viewed','business_called_ai','trial','onboarding','paid','expansion','lost'));

-- ── Demo analytics ──
ALTER TABLE demos ADD COLUMN IF NOT EXISTS unique_visitors int NOT NULL DEFAULT 0;
ALTER TABLE demos ADD COLUMN IF NOT EXISTS total_dwell_ms bigint NOT NULL DEFAULT 0;
ALTER TABLE demos ADD COLUMN IF NOT EXISTS converted_trial boolean NOT NULL DEFAULT false;
ALTER TABLE demos ADD COLUMN IF NOT EXISTS converted_paid boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS demo_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_id uuid NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  visitor_id uuid,
  dwell_ms int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_demo_views_demo ON demo_views(demo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demo_views_visitor ON demo_views(demo_id, visitor_id);

ALTER TABLE demo_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Partner demo views read" ON demo_views;
CREATE POLICY "Partner demo views read" ON demo_views FOR SELECT USING (partner_id = get_partner_id());
