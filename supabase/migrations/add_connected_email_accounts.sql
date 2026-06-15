-- Migration: Connect Email (OAuth mailbox) — the AI reads/replies from the owner's
-- own Gmail/Workspace inbox. Run in the Supabase SQL Editor.
--
-- Mirrors the channels association pattern (tenant_id + ai_employee_id + status)
-- but stores first-class OAuth state. access_token/refresh_token are encrypted at
-- rest (AES-256-GCM, lib/mailbox/crypto.ts) — never plaintext.
-- provider is 'google' now; 'microsoft' can be added later with the same shape.

CREATE TABLE IF NOT EXISTS connected_email_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL DEFAULT 'google',          -- 'google' | 'microsoft'
  email_address TEXT NOT NULL,
  access_token  TEXT NOT NULL,                            -- encrypted (AES-256-GCM)
  refresh_token TEXT,                                     -- encrypted (AES-256-GCM)
  token_expiry  TIMESTAMPTZ,
  scopes        TEXT,
  history_id    TEXT,                                     -- Gmail incremental cursor
  last_polled_at TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'connected',        -- connected | disconnected | error
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (ai_employee_id, provider)
);

-- Poll worker scans connected accounts.
CREATE INDEX IF NOT EXISTS idx_cea_status ON connected_email_accounts(status)
  WHERE status = 'connected';
CREATE INDEX IF NOT EXISTS idx_cea_tenant ON connected_email_accounts(tenant_id);

-- Dedupe: the provider's message id, so an inbound email is never replied to twice
-- across polls. (Resend/other channels leave this NULL.)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_id TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_external_id ON messages(tenant_id, external_id)
  WHERE external_id IS NOT NULL;
