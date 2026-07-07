-- Migration: assistant action-execution log
-- Every action the personal assistant attempts is recorded here — who, what, on which
-- channel, its draft payload, and the real result. The assistant may only claim success
-- once a row reaches status='executed'. Run in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS assistant_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid,
  assistant_id uuid,
  action_type text NOT NULL,          -- send_email | reply_instagram | send_sms | …
  channel text,                       -- email | instagram | sms | stripe | …
  target_id text,                     -- recipient (phone / contact id / conversation id)
  payload jsonb,                      -- draft body + details
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','executed','failed','cancelled')),
  error_message text,
  external_response_id text,          -- provider message/charge id on success
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  executed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_assistant_actions_tenant ON assistant_actions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_actions_status ON assistant_actions(tenant_id, status, created_at DESC);

-- Server-only (admin client, after auth + tenant resolution).
ALTER TABLE assistant_actions ENABLE ROW LEVEL SECURITY;
