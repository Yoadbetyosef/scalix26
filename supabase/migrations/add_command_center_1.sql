-- ============================================================================
-- CEO Command Center — Phase 1 schema (founder-confidential)
-- Run in the Supabase SQL editor (project bphpnlgjlklgwhewsnrm). Idempotent.
--
-- These tables hold the founder's operating model: scenarios, assumptions, locked actuals, forecast
-- snapshots, expenses/headcount, targets, the weekly scoreboard, and a full audit log. Money is stored as
-- INTEGER CENTS (bigint); rates as numeric — never floating-point currency.
--
-- SECURITY: every table has RLS ENABLED with NO policies → reachable only via the service role from
-- founder-gated server code (same lockdown as the billing tables). No partner/customer/anon access.
-- Access is additionally gated in the app by CEO_COMMAND_CENTER_ENABLED + the founder allow-list.
-- ============================================================================

-- Scenarios / configs (Conservative / Base / Aggressive / Custom).
CREATE TABLE IF NOT EXISTS cc_configs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  scenario_type text NOT NULL DEFAULT 'custom' CHECK (scenario_type IN ('conservative','base','aggressive','custom')),
  is_active     boolean NOT NULL DEFAULT false,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Editable assumptions (category/key), versioned by effective window. numeric_value is exact numeric.
CREATE TABLE IF NOT EXISTS cc_assumptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id      uuid NOT NULL REFERENCES cc_configs(id) ON DELETE CASCADE,
  category       text NOT NULL,
  key            text NOT NULL,
  numeric_value  numeric,
  text_value     text,
  unit           text,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to   date,
  source         text,
  notes          text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (config_id, category, key, effective_from)
);

-- Locked historical actuals — NEVER overwritten when assumptions change. is_locked guards edits.
CREATE TABLE IF NOT EXISTS cc_actuals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month      date NOT NULL,               -- first-of-month
  metric_key text NOT NULL,
  value      numeric NOT NULL,            -- cents for money metrics, else raw
  source     text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','derived')),
  is_locked  boolean NOT NULL DEFAULT false,
  notes      text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month, metric_key)
);

-- Scenario metadata (a config used as a named, comparable scenario).
CREATE TABLE IF NOT EXISTS cc_scenarios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  description    text,
  base_config_id uuid REFERENCES cc_configs(id) ON DELETE SET NULL,
  scenario_type  text NOT NULL DEFAULT 'custom',
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Immutable forecast snapshots (versioned; deduped by input_hash for reproducibility).
CREATE TABLE IF NOT EXISTS cc_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id  uuid REFERENCES cc_scenarios(id) ON DELETE CASCADE,
  generated_at timestamptz NOT NULL DEFAULT now(),
  start_month  date,
  end_month    date,
  output_json  jsonb NOT NULL,
  input_hash   text,
  version      int NOT NULL DEFAULT 1
);

-- Expense line items (fixed / variable / usage-driven).
CREATE TABLE IF NOT EXISTS cc_expense_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id        uuid NOT NULL REFERENCES cc_scenarios(id) ON DELETE CASCADE,
  category           text NOT NULL,
  name               text NOT NULL,
  expense_type       text NOT NULL DEFAULT 'fixed' CHECK (expense_type IN ('fixed','variable','usage')),
  monthly_fixed_cents bigint NOT NULL DEFAULT 0,
  unit_cost_cents    bigint NOT NULL DEFAULT 0,
  quantity_driver    text,
  start_month        int,
  end_month          int
);

-- Headcount plan (payroll driver).
CREATE TABLE IF NOT EXISTS cc_headcount (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id        uuid NOT NULL REFERENCES cc_scenarios(id) ON DELETE CASCADE,
  department         text NOT NULL,
  role               text NOT NULL,
  headcount          int NOT NULL DEFAULT 1,
  salary_per_month_cents bigint NOT NULL DEFAULT 0,
  commission_rate    numeric NOT NULL DEFAULT 0,
  payroll_burden_rate numeric NOT NULL DEFAULT 0,
  employment_type    text NOT NULL DEFAULT 'employee' CHECK (employment_type IN ('employee','contractor')),
  start_month        int,
  end_month          int
);

-- Executive targets (metric goals by period).
CREATE TABLE IF NOT EXISTS cc_targets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key   text NOT NULL,
  period       text NOT NULL,               -- e.g. 'monthly','2027','all'
  target_value numeric NOT NULL,
  UNIQUE (metric_key, period)
);

-- Weekly Scoreboard — per-engine weekly goal vs actual.
CREATE TABLE IF NOT EXISTS cc_scoreboard (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start   date NOT NULL,
  engine       text NOT NULL CHECK (engine IN ('direct','affiliate','whiteLabel','expansion')),
  metric_key   text NOT NULL,
  goal_value   numeric NOT NULL,
  actual_value numeric,
  notes        text,
  owner        text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_start, engine, metric_key)
);
-- Idempotent safety: add `owner` on an already-created table (no-op on fresh installs).
ALTER TABLE cc_scoreboard ADD COLUMN IF NOT EXISTS owner text;

-- Full audit of every mutation.
CREATE TABLE IF NOT EXISTS cc_change_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id   uuid,
  changed_by  text NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  before_json jsonb,
  after_json  jsonb
);

CREATE INDEX IF NOT EXISTS cc_assumptions_config_idx ON cc_assumptions (config_id, category);
CREATE INDEX IF NOT EXISTS cc_snapshots_scenario_idx ON cc_snapshots (scenario_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS cc_change_log_entity_idx  ON cc_change_log (entity_type, entity_id);

-- Lock RLS on every table (server-only; no policies = no partner/customer/anon reach).
ALTER TABLE cc_configs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_assumptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_actuals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_scenarios      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_snapshots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_expense_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_headcount      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_targets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_scoreboard     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_change_log     ENABLE ROW LEVEL SECURITY;

-- ── Reverse (down) — paste to fully roll back Phase 1 ────────────────────────────────────────────────
-- DROP TABLE IF EXISTS cc_change_log, cc_scoreboard, cc_targets, cc_headcount, cc_expense_items,
--   cc_snapshots, cc_scenarios, cc_actuals, cc_assumptions, cc_configs CASCADE;
