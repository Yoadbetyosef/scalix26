-- Migration: Add per-agent business identity fields to ai_employees
-- Run this in Supabase SQL Editor for existing databases

ALTER TABLE ai_employees
  ADD COLUMN IF NOT EXISTS business_name TEXT,
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip TEXT,
  ADD COLUMN IF NOT EXISTS business_hours JSONB DEFAULT '{"mon":"9:00-17:00","tue":"9:00-17:00","wed":"9:00-17:00","thu":"9:00-17:00","fri":"9:00-17:00","sat":"closed","sun":"closed"}',
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS forward_to_phone TEXT;

-- Backfill business_name from tenants for existing agents
UPDATE ai_employees ae
SET
  business_name = t.business_name,
  industry      = t.industry,
  website       = t.website,
  phone         = t.phone,
  email         = t.email,
  address       = t.address,
  city          = t.city,
  state         = t.state,
  zip           = t.zip,
  business_hours = t.business_hours,
  timezone      = t.timezone
FROM tenants t
WHERE ae.tenant_id = t.id
  AND ae.business_name IS NULL;

-- Index for fast agent lookup from channels
CREATE INDEX IF NOT EXISTS idx_channels_ai_employee_id ON channels(ai_employee_id);

