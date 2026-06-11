-- Migration: per-tenant secret lead intake token
-- Powers the unique inbound URL /api/leads/inbound/<token> so external lead
-- sources are identified securely instead of passing tenant_id in the body.
-- Run this in Supabase SQL Editor for existing databases.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lead_intake_token UUID DEFAULT uuid_generate_v4();

-- Backfill any existing tenants that don't have a token yet
UPDATE tenants SET lead_intake_token = uuid_generate_v4() WHERE lead_intake_token IS NULL;

ALTER TABLE tenants ALTER COLUMN lead_intake_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_lead_intake_token ON tenants(lead_intake_token);
