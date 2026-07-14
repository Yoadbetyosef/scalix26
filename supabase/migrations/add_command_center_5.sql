-- ============================================================================
-- CEO Command Center — Phase 3B: Support & Operations overlay + Team roster (V2)
-- Run AFTER add_command_center_4.sql. Idempotent, additive, RLS-locked (server-only).
-- No customer message/conversation CONTENT is stored — operational metadata only.
-- ============================================================================

-- Manual operational overlay for a support/operational signal, keyed by the SOURCE RECORD id (a conversation
-- id or a channel id — hence text, not uuid). The observed signal (channel/status/human_takeover/failure) is
-- derived live; this overlay is the human operating layer on top and never mutates the source record.
CREATE TABLE IF NOT EXISTS cc_support_overlay (
  signal_id       text PRIMARY KEY,
  owner           text,
  issue_type      text,
  severity        text CHECK (severity IS NULL OR severity IN ('low','medium','high','critical')),
  status          text,
  notes           text,
  resolution_note text,
  updated_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Live team roster for workload-based capacity planning (NOT scenario-bound — that is cc_headcount).
CREATE TABLE IF NOT EXISTS cc_team_roles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department          text NOT NULL CHECK (department IN ('engineering','product','sales','marketing','affiliate','partner_success','onboarding','customer_success','support','finance','operations','executive')),
  role                text NOT NULL,
  current_headcount   int NOT NULL DEFAULT 0,
  planned_headcount   int NOT NULL DEFAULT 0,
  monthly_salary_cents bigint NOT NULL DEFAULT 0,
  commission_cents    bigint NOT NULL DEFAULT 0,
  payroll_burden_pct  numeric NOT NULL DEFAULT 0,        -- 0..1 fraction added on top of salary
  start_date          date,
  capacity_driver     text NOT NULL DEFAULT 'manual' CHECK (capacity_driver IN ('support_hours','onboarding_accounts','sales_opportunities','active_affiliates','producing_agencies','cs_customers','manual')),
  capacity_per_employee numeric NOT NULL DEFAULT 0,      -- driver units one FTE can serve per period
  target_utilization  numeric NOT NULL DEFAULT 0.8,      -- 0..1
  notes               text,
  updated_by          text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_team_roles_dept_idx ON cc_team_roles (department);

ALTER TABLE cc_support_overlay ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_team_roles      ENABLE ROW LEVEL SECURITY;

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS cc_support_overlay, cc_team_roles CASCADE;
