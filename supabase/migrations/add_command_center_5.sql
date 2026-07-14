-- ============================================================================
-- CEO Command Center — Phase 3B: Support & Operations overlay + Team (Reality / Plan / Config)
-- Run AFTER add_command_center_4.sql. Additive, idempotent, reversible, RLS-locked (server-only).
-- Strict layer separation: cc_team_reality = today's org (reality), cc_hiring_plan = future hires (plan),
-- cc_capacity_model = capacity assumptions (config). Reality never includes planned/simulated hires.
-- No customer/conversation CONTENT is stored — operational + org metadata only.
-- Create cc_capacity_model FIRST (the other two reference it).
-- ============================================================================

-- ── 1) Manual support/operational overlay (approved as proposed) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS cc_support_overlay (
  signal_id       text PRIMARY KEY,           -- source record id (conversation OR channel)
  owner           text,
  issue_type      text,
  severity        text CHECK (severity IS NULL OR severity IN ('low','medium','high','critical')),
  status          text,
  notes           text,
  resolution_note text,
  updated_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── 2) Capacity Model (CONFIG only) — capacity assumptions per role type, versioned by effective dates ──
CREATE TABLE IF NOT EXISTS cc_capacity_model (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key              text NOT NULL,
  label                 text NOT NULL,
  capacity_driver       text NOT NULL CHECK (capacity_driver IN ('support_hours','onboarding_accounts','sales_opportunities','active_affiliates','producing_agencies','cs_customers','manual')),
  capacity_per_employee numeric NOT NULL DEFAULT 0 CHECK (capacity_per_employee >= 0),
  capacity_unit         text NOT NULL DEFAULT 'units',
  capacity_period       text NOT NULL DEFAULT 'week' CHECK (capacity_period IN ('day','week','month')),
  demand_metric_key     text,
  target_utilization    numeric NOT NULL DEFAULT 0.8 CHECK (target_utilization > 0 AND target_utilization <= 1),
  source_classification text NOT NULL DEFAULT 'manual',
  effective_from        date NOT NULL DEFAULT current_date,
  effective_to          date,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes                 text,
  updated_by            text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
-- One ACTIVE model per role_key (historical inactive versions allowed → versioning, not overwrite).
CREATE UNIQUE INDEX IF NOT EXISTS cc_capacity_model_active_key ON cc_capacity_model (role_key) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS cc_capacity_model_status_idx ON cc_capacity_model (status);
CREATE INDEX IF NOT EXISTS cc_capacity_model_effective_idx ON cc_capacity_model (effective_from, effective_to);

-- Seed the default capacity assumptions you specified (idempotent; period-explicit).
INSERT INTO cc_capacity_model (role_key, label, capacity_driver, capacity_per_employee, capacity_unit, capacity_period, demand_metric_key) VALUES
  ('support_rep',           'Support Rep',             'support_hours',       40,  'productive_hours', 'week',  'support.incident_hours'),
  ('onboarding_specialist', 'Onboarding Specialist',   'onboarding_accounts', 20,  'active_accounts',  'month', 'onboarding.active_accounts'),
  ('csm',                   'Customer Success Manager','cs_customers',        120, 'active_customers', 'month', 'lifecycle.activated_customers'),
  ('affiliate_manager',     'Affiliate Manager',       'active_affiliates',   75,  'productive_affiliates','month','affiliate.active_partners'),
  ('partner_manager',       'Partner Manager',         'producing_agencies',  30,  'producing_agencies','month','whitelabel.producing_agencies'),
  ('sales_rep',             'Sales Rep',               'sales_opportunities', 0,   'qualified_opportunities','week','sales.qualified_opportunities')
ON CONFLICT (role_key) WHERE status = 'active' DO NOTHING;

-- ── 3) Team Reality (REALITY only) — current org, aggregated by role, versioned by effective dates ──────
CREATE TABLE IF NOT EXISTS cc_team_reality (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department           text NOT NULL CHECK (department IN ('engineering','product','sales','marketing','affiliate','partner_success','onboarding','customer_success','support','finance','operations','executive')),
  role                 text NOT NULL,
  current_headcount    int NOT NULL DEFAULT 0 CHECK (current_headcount >= 0),   -- reality ONLY; never planned hires
  monthly_salary_cents bigint NOT NULL DEFAULT 0 CHECK (monthly_salary_cents >= 0), -- base salary per employee / month
  commission_cents     bigint NOT NULL DEFAULT 0 CHECK (commission_cents >= 0),     -- expected commission per employee / month
  payroll_burden_pct   numeric NOT NULL DEFAULT 0 CHECK (payroll_burden_pct >= 0),  -- fraction of base salary
  capacity_model_id    uuid REFERENCES cc_capacity_model(id) ON DELETE SET NULL,
  effective_from       date NOT NULL DEFAULT current_date,
  effective_to         date,
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes                text,
  updated_by           text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_team_reality_dept_idx ON cc_team_reality (department);
CREATE INDEX IF NOT EXISTS cc_team_reality_role_idx ON cc_team_reality (role);
CREATE INDEX IF NOT EXISTS cc_team_reality_status_idx ON cc_team_reality (status);
CREATE INDEX IF NOT EXISTS cc_team_reality_effective_idx ON cc_team_reality (effective_from, effective_to);

-- ── 4) Hiring Plan (PLAN only) — future hires; payroll kept separate from reality ──────────────────────
CREATE TABLE IF NOT EXISTS cc_hiring_plan (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department           text NOT NULL CHECK (department IN ('engineering','product','sales','marketing','affiliate','partner_success','onboarding','customer_success','support','finance','operations','executive')),
  role                 text NOT NULL,
  headcount            int NOT NULL DEFAULT 1 CHECK (headcount > 0),
  planned_start_date   date,
  monthly_salary_cents bigint NOT NULL DEFAULT 0 CHECK (monthly_salary_cents >= 0),
  commission_cents     bigint NOT NULL DEFAULT 0 CHECK (commission_cents >= 0),
  payroll_burden_pct   numeric NOT NULL DEFAULT 0 CHECK (payroll_burden_pct >= 0),
  capacity_model_id    uuid REFERENCES cc_capacity_model(id) ON DELETE SET NULL,
  hiring_reason        text,
  growth_engine        text CHECK (growth_engine IS NULL OR growth_engine IN ('direct','affiliate','whiteLabel','expansion')),
  priority             text CHECK (priority IS NULL OR priority IN ('low','medium','high')),
  status               text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','open','interviewing','offer','hired','on_hold','cancelled')),
  notes                text,
  updated_by           text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_hiring_plan_status_idx ON cc_hiring_plan (status, planned_start_date);
CREATE INDEX IF NOT EXISTS cc_hiring_plan_dept_idx ON cc_hiring_plan (department);
CREATE INDEX IF NOT EXISTS cc_hiring_plan_engine_idx ON cc_hiring_plan (growth_engine);

-- ── Atomic "Move to Team Reality": create a new effective reality row from a plan, mark the plan hired,
--    and audit BOTH — all in one transaction (function bodies are atomic). Reality is never auto-updated;
--    the app calls this only on an explicit founder action.
CREATE OR REPLACE FUNCTION cc_move_hire_to_reality(p_plan_id uuid, p_actor text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_plan cc_hiring_plan; v_new_id uuid;
BEGIN
  SELECT * INTO v_plan FROM cc_hiring_plan WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'hiring plan % not found', p_plan_id; END IF;
  IF v_plan.status = 'hired' THEN RAISE EXCEPTION 'hiring plan % already hired', p_plan_id; END IF;

  INSERT INTO cc_team_reality (department, role, current_headcount, monthly_salary_cents, commission_cents, payroll_burden_pct, capacity_model_id, effective_from, status, notes, updated_by, updated_at)
  VALUES (v_plan.department, v_plan.role, v_plan.headcount, v_plan.monthly_salary_cents, v_plan.commission_cents, v_plan.payroll_burden_pct, v_plan.capacity_model_id, current_date, 'active', v_plan.notes, p_actor, now())
  RETURNING id INTO v_new_id;

  UPDATE cc_hiring_plan SET status = 'hired', updated_by = p_actor, updated_at = now() WHERE id = p_plan_id;

  INSERT INTO cc_change_log (entity_type, entity_id, changed_by, changed_at, before_json, after_json) VALUES
    ('team_reality', v_new_id, p_actor, now(), NULL, to_jsonb((SELECT r FROM cc_team_reality r WHERE r.id = v_new_id))),
    ('hiring_plan',  p_plan_id, p_actor, now(), to_jsonb(v_plan), to_jsonb((SELECT h FROM cc_hiring_plan h WHERE h.id = p_plan_id)));
  RETURN v_new_id;
END $$;

ALTER TABLE cc_support_overlay ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_capacity_model  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_team_reality    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_hiring_plan     ENABLE ROW LEVEL SECURITY;

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS cc_move_hire_to_reality(uuid, text);
-- DROP TABLE IF EXISTS cc_hiring_plan, cc_team_reality, cc_capacity_model, cc_support_overlay CASCADE;
