-- Migration: drip campaign system — automated SMS follow-ups to open leads.
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS drip_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contact_phone TEXT NOT NULL,
  contact_name TEXT,
  issue TEXT,
  business_name TEXT,
  from_number TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'stopped')),
  messages_sent INTEGER DEFAULT 0,
  next_send_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE drip_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant drip access" ON drip_campaigns;
CREATE POLICY "Tenant drip access" ON drip_campaigns
  FOR ALL USING (tenant_id = get_tenant_id());

-- The cron worker scans active campaigns that are due.
CREATE INDEX IF NOT EXISTS idx_drip_due ON drip_campaigns(status, next_send_at);
-- STOP handling looks up by phone + tenant.
CREATE INDEX IF NOT EXISTS idx_drip_phone ON drip_campaigns(tenant_id, contact_phone);
CREATE INDEX IF NOT EXISTS idx_drip_lead ON drip_campaigns(lead_id);
