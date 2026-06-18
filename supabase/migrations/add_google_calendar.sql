-- Phase 3a: Google Calendar connect + write events. ADDITIVE + FAIL-SAFE.
-- Reuses the existing Google OAuth client ("Scalix AI", GOOGLE_CLIENT_ID/SECRET);
-- this is a SEPARATE per-tenant grant so existing Gmail grants are untouched.
-- Run in the Supabase SQL Editor.

-- Per-tenant calendar connection (one per tenant). Tokens are AES-256-GCM
-- encrypted by the app (lib/mailbox/crypto) before they ever reach the DB.
CREATE TABLE IF NOT EXISTS connected_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'google',
  email_address TEXT,
  access_token TEXT NOT NULL,   -- encrypted
  refresh_token TEXT,           -- encrypted
  token_expiry TIMESTAMPTZ,
  scopes TEXT,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  calendar_summary TEXT,
  status TEXT NOT NULL DEFAULT 'connected',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE connected_calendars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant calendars access" ON connected_calendars;
CREATE POLICY "Tenant calendars access" ON connected_calendars FOR ALL USING (tenant_id = get_tenant_id());

-- Store the created Google event id on the appointment (for later cancel/reschedule sync).
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS google_event_id TEXT;
