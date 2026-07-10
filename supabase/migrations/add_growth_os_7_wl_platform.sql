-- Growth OS Sprint 7 — White Label SaaS Platform (Phase 1).
-- Per-partner infrastructure credentials (encrypted), configurable platform pricing, and the link
-- from a provisioned client workspace back to its white-label partner. Reuses tenants/ai_employees/
-- provisioning. Idempotent. Secret values are AES-GCM encrypted (lib/mailbox/crypto) — never stored
-- in plaintext and never exposed via RLS (service-role access only).

CREATE TABLE IF NOT EXISTS partner_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('twilio','openai','elevenlabs','email','meta','google')),
  status text NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected','connected','needs_attention')),
  credentials_encrypted text,           -- AES-256-GCM blob; server-only
  meta jsonb NOT NULL DEFAULT '{}'::jsonb, -- non-secret hints (masked sid, from-email, model)
  health int,                            -- 0..100
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, provider)
);
-- RLS on, NO partner policy: credentials are reachable only through service-role API routes that
-- strip secrets before returning. (Partners must never SELECT credentials_encrypted directly.)
ALTER TABLE partner_integrations ENABLE ROW LEVEL SECURITY;

-- Configurable platform settings (admin-editable) — e.g. white-label onboarding fee + monthly price.
CREATE TABLE IF NOT EXISTS platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- Link a provisioned client workspace to its white-label partner (client tenants have user_id NULL).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS white_label_partner_id uuid REFERENCES partners(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_wl_partner ON tenants(white_label_partner_id) WHERE white_label_partner_id IS NOT NULL;

-- Partner-level white-label config: business identity (step 1), default retail per plan (step 3),
-- and whether the setup wizard has been completed.
ALTER TABLE partners ADD COLUMN IF NOT EXISTS wl_business jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS wl_retail_defaults jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS wl_setup_complete boolean NOT NULL DEFAULT false;
