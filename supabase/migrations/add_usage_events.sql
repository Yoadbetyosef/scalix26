-- Migration: per-tenant usage/cost events (COGS tracking)
-- Run in the Supabase SQL Editor. Records the real cost of each billable unit (LLM tokens,
-- voice seconds, SMS segments) so the admin platform can show cost-per-customer and run-rate.

CREATE TABLE IF NOT EXISTS usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL,                 -- 'llm' | 'voice' | 'sms'
  provider text,                      -- 'anthropic' | 'deepgram' | 'twilio'
  model text,
  units numeric NOT NULL DEFAULT 0,   -- tokens / seconds / segments
  unit_type text,                     -- 'tokens' | 'seconds' | 'segments'
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_created ON usage_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at DESC);

-- Service-role only (the app writes via the admin client; the admin reads via the admin API).
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
