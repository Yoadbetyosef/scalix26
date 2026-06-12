-- Migration: Speed to Lead — leads table
-- Run this in Supabase SQL Editor for existing databases

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('missed_call','voice_call','web_form','google_lsa','facebook','yelp','angi','other')),
  phone TEXT NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new','contacted','booked','called_back','dismissed')),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security — same pattern as every other table
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant leads access" ON leads;
CREATE POLICY "Tenant leads access" ON leads FOR ALL USING (tenant_id = get_tenant_id());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leads_tenant_id ON leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
