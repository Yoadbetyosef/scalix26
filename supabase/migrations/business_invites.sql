-- ============================================================================
-- Drop 2 — Client Invitations & Client Login
-- Run this in the Supabase SQL editor (project bphpnlgjlklgwhewsnrm).
-- Adds ONE table (business_invites) + a few nullable login-tracking columns on
-- tenants. No changes to existing RLS or the customer product. Client access
-- reuses the single-owner model: on accept we set tenants.user_id = the client,
-- so the existing get_tenant_id() RLS + owner-mode resolver just work.
-- ============================================================================

-- Login lifecycle timestamps (nullable, additive) ---------------------------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS first_login_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_login_at  timestamptz;

-- The invite record ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_invites (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  partner_id        uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  email             text NOT NULL,
  first_name        text,
  last_name         text,
  phone             text,
  role              text NOT NULL DEFAULT 'business_owner',
  token             text NOT NULL UNIQUE,           -- secure random; the accept-link secret
  status            text NOT NULL DEFAULT 'draft',  -- draft|sent|pending|accepted|expired|revoked
  invited_by        uuid,                           -- partner user id who sent it
  accepted_user_id  uuid,                           -- the auth user who accepted
  invited_at        timestamptz,
  opened_at         timestamptz,                    -- recipient opened the link (→ pending)
  accepted_at       timestamptz,
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Indexes for scale (2k+ businesses, 50k+ users): list by partner/status, look
-- up by tenant, resolve by token, and enforce one live invite per email+business.
CREATE INDEX IF NOT EXISTS business_invites_tenant_idx      ON business_invites (tenant_id);
CREATE INDEX IF NOT EXISTS business_invites_partner_status  ON business_invites (partner_id, status);
CREATE INDEX IF NOT EXISTS business_invites_token_idx       ON business_invites (token);
CREATE UNIQUE INDEX IF NOT EXISTS business_invites_email_tenant_uniq
  ON business_invites (lower(email), tenant_id);

-- RLS: server-only. All reads/writes go through admin-client APIs that validate
-- partner ownership + tenant scoping; the browser never touches this table.
ALTER TABLE business_invites ENABLE ROW LEVEL SECURITY;
-- (No policies → no anon/authenticated access; service role bypasses RLS.)
