-- Migration: durable trace for Twilio numbers that failed to release on agent
-- deletion (so a SID is never silently dropped; supports manual retry).
-- Run this in the Supabase SQL Editor.
-- NOTE: tenant_id / ai_employee_id are plain UUIDs (NO foreign key) on purpose —
-- the agent is being deleted, so a cascading FK would wipe this very record.

CREATE TABLE IF NOT EXISTS pending_number_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  ai_employee_id UUID,
  twilio_sid TEXT NOT NULL,
  twilio_number TEXT,
  error TEXT,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Internal ops table: RLS on with no policy = service-role access only.
ALTER TABLE pending_number_releases ENABLE ROW LEVEL SECURITY;
