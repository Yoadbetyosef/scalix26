-- Migration: audit log for per-tenant module changes
-- Run this in the Supabase SQL Editor. Records every admin change to a business's modules:
-- who changed it, when, and exactly what was added/removed.

CREATE TABLE IF NOT EXISTS module_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  changed_by text NOT NULL,               -- admin email
  before_modules text[] NOT NULL DEFAULT '{}',
  after_modules text[] NOT NULL DEFAULT '{}',
  added text[] NOT NULL DEFAULT '{}',
  removed text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_module_audit_tenant ON module_audit_log(tenant_id, created_at DESC);

-- Locked down: only the service role (admin API) reads/writes. No policies = deny for
-- anon/authenticated; the admin client bypasses RLS.
ALTER TABLE module_audit_log ENABLE ROW LEVEL SECURITY;
