-- Migration: Admin platform foundation (RBAC, generalized audit, notes, tags, suspension)
-- Run in the Supabase SQL Editor. Idempotent.

-- Team roles for the internal admin platform.
CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  role text NOT NULL DEFAULT 'read_only'
    CHECK (role IN ('super_admin','support','sales','developer','read_only')),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admin_users (email, role) VALUES ('yoadbetyosef@gmail.com', 'super_admin')
  ON CONFLICT (email) DO UPDATE SET role = 'super_admin';

-- One generalized audit trail for every admin action across the platform.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email text NOT NULL,
  action text NOT NULL,             -- e.g. 'module.update', 'business.suspend', 'impersonate'
  target_type text,                 -- e.g. 'tenant'
  target_id uuid,
  target_label text,                -- human label (business name)
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_id, created_at DESC);

-- Internal, admin-only notes per business.
CREATE TABLE IF NOT EXISTS admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  admin_email text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_notes_tenant ON admin_notes(tenant_id, created_at DESC);

-- Tags + suspension live on the tenant row.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

-- Locked down: only the service role (admin API) touches these. Admin client bypasses RLS.
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_notes ENABLE ROW LEVEL SECURITY;
