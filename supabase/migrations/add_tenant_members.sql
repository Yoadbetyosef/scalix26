-- ============================================================================
-- TEAM MEMBERS — more than one person inside one business.
--
-- Run in the Supabase SQL editor (project bphpnlgjlklgwhewsnrm), PART BY PART,
-- checking the result of each before running the next. A previous monolithic
-- hand-run script on this project rolled back silently and nobody noticed for
-- days; the parts exist so that cannot happen again.
--
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT
-- ----------------------------------------------------------------------------
-- Until now a business WAS an auth user: tenants.user_id, and get_tenant_id()
-- reading it. This adds a membership table beside that and teaches
-- get_tenant_id() to fall back to it — OWNER LOOKUP STAYS FIRST AND UNCHANGED.
--
-- That ordering is the whole safety argument. Every user who owns a tenant today
-- hits branch one and gets back exactly the uuid they get back now, so no
-- existing tenant's RLS changes in any way. Only a user who owns NO tenant can
-- reach branch two, and today that user resolves to NULL and can see nothing.
-- The change is strictly additive: it can grant access that did not exist, and
-- it cannot alter or remove access that did.
--
-- Mirrors partner_members / get_partner_id() (add_partner_os_1_identity.sql),
-- which already solved this exact problem one layer up. Same shape, same status
-- vocabulary, same one-active-org-per-user index, so the two planes stay legible
-- as one idea rather than two.
-- ============================================================================


-- ── PART 0 — PRE-CHECK. RUN THIS ALONE. DO NOT SKIP. ────────────────────────
--
-- Part 3 REPLACES get_tenant_id(). This repository is known to have drifted from
-- production (69 live tables that no migration here creates), so the definition
-- below may not be the definition running. Read the live one first and confirm
-- it matches what Part 3 expects to be replacing.
--
-- EXPECTED (supabase/schema.sql:273):
--     SELECT id FROM tenants WHERE user_id = auth.uid() LIMIT 1;
--
-- If what comes back is anything else, STOP and hand it back before running
-- Part 3 — replacing a predicate you have not read is how tenant isolation
-- breaks for everybody at once.

SELECT prosrc FROM pg_proc WHERE proname = 'get_tenant_id';


-- ── PART 1 — the membership table ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL until the invitee accepts and an auth user exists to point at.
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'staff'
                  CHECK (role IN ('owner','manager','staff')),
  status        text NOT NULL DEFAULT 'invited'
                  CHECK (status IN ('active','invited','disabled')),
  -- Carried from the invitation so a pending row is displayable before acceptance.
  invited_email text,
  full_name     text,
  invited_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at    timestamptz,
  accepted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

-- One ACTIVE membership per user keeps get_tenant_id() deterministic — the same
-- rule uq_partner_member_active_user enforces on the partner side, for the same
-- reason. A person may be invited to several businesses but may only be live in
-- one; lifting that later is a policy change here plus a workspace switcher, not
-- a rewrite.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_member_active_user
  ON tenant_members (user_id) WHERE status = 'active' AND user_id IS NOT NULL;

-- One live invitation per email per business (case-insensitive), so "invite her
-- again" updates the pending row instead of growing a second one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_member_invited_email
  ON tenant_members (tenant_id, lower(invited_email))
  WHERE invited_email IS NOT NULL AND status <> 'disabled';

CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant ON tenant_members (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_user   ON tenant_members (user_id);


-- ── PART 2 — RLS: server-only, exactly like business_invites ────────────────
--
-- Enabled with NO policies, so anon/authenticated reach nothing through
-- PostgREST and only the service role (the /api/team routes, which validate the
-- caller's tenant and role first) can read or write it. A membership table that
-- members could edit is a privilege-escalation primitive; this one cannot be
-- touched from a browser at all.

ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;


-- ── PART 3 — teach get_tenant_id() about membership ─────────────────────────
--
-- Read PART 0 first.
--
-- COALESCE, owner branch first: unchanged for every current user (see header).
-- STABLE is added because it always was semantically — the original omitted it,
-- and saying so lets the planner cache the call within a statement instead of
-- re-running it per row, which matters on tables the policies touch row-by-row.

CREATE OR REPLACE FUNCTION get_tenant_id()
RETURNS uuid AS $$
  SELECT COALESCE(
    (SELECT id FROM tenants
      WHERE user_id = auth.uid()
      LIMIT 1),
    (SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND status = 'active'
      ORDER BY created_at ASC
      LIMIT 1)
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- The caller's role in the business they are currently resolved into. Used by
-- future RLS that needs to distinguish staff from owner at the row level; the
-- application reads the role through lib/team/roles.ts, not this.
CREATE OR REPLACE FUNCTION tenant_member_role()
RETURNS text AS $$
  SELECT COALESCE(
    (SELECT 'owner' FROM tenants
      WHERE user_id = auth.uid()
      LIMIT 1),
    (SELECT role FROM tenant_members
      WHERE user_id = auth.uid() AND status = 'active'
      ORDER BY created_at ASC
      LIMIT 1)
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;


-- ── PART 4 — backfill every existing owner as an 'owner' member ─────────────
--
-- Not load-bearing for access: owners resolve through branch one of
-- get_tenant_id() and through the owner path in lib/workspace.ts, both of which
-- ignore this table entirely. It exists so the Team screen can list the owner
-- beside the staff instead of showing a business whose owner is invisible.
--
-- ON CONFLICT DO NOTHING makes it re-runnable.

INSERT INTO tenant_members (tenant_id, user_id, role, status, accepted_at, created_at)
SELECT t.id, t.user_id, 'owner', 'active', COALESCE(t.created_at, now()), COALESCE(t.created_at, now())
FROM tenants t
WHERE t.user_id IS NOT NULL
ON CONFLICT (tenant_id, user_id) DO NOTHING;


-- ── PART 5 — verify, then stop ──────────────────────────────────────────────
--
-- Expect: owners = the number of live tenants with a user_id, staff = 0.
-- Expect the get_tenant_id() body to now contain 'tenant_members'.

SELECT role, status, count(*) FROM tenant_members GROUP BY role, status ORDER BY role;
SELECT prosrc LIKE '%tenant_members%' AS get_tenant_id_is_membership_aware
FROM pg_proc WHERE proname = 'get_tenant_id';


-- ── Reverse (down) ──────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION get_tenant_id() RETURNS uuid AS $$
--   SELECT id FROM tenants WHERE user_id = auth.uid() LIMIT 1;
-- $$ LANGUAGE SQL SECURITY DEFINER;
-- DROP FUNCTION IF EXISTS tenant_member_role();
-- DROP TABLE IF EXISTS tenant_members;
