-- ============================================================================
-- CEO Command Center — Phase 3C: Mission milestones, Operating Plan, War Room, Scoreboard V2
-- Run AFTER add_command_center_5.sql. Additive, idempotent, reversible, RLS-locked (server-only).
-- Mission targets reuse cc_targets (period='mission'); this migration adds milestones, the operating plan,
-- war-room tasks, and extends the weekly scoreboard.
-- ============================================================================

-- Mission milestones — the ladder from current reality to the company target. Config (target thresholds +
-- optional target dates); current/gap/forecast are DERIVED, never stored.
CREATE TABLE IF NOT EXISTS cc_mission_milestones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL UNIQUE,
  label        text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('arr','customers','operational')),
  metric_key   text NOT NULL,
  target_value numeric NOT NULL,
  target_date  date,
  sort_order   int NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  notes        text,
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO cc_mission_milestones (key, label, kind, metric_key, target_value, sort_order) VALUES
  ('arr_1m','$1M ARR','arr','arr_cents',100000000,10),
  ('arr_5m','$5M ARR','arr','arr_cents',500000000,20),
  ('arr_10m','$10M ARR','arr','arr_cents',1000000000,30),
  ('arr_25m','$25M ARR','arr','arr_cents',2500000000,40),
  ('arr_50m','$50M ARR','arr','arr_cents',5000000000,50),
  ('arr_100m','$100M ARR','arr','arr_cents',10000000000,60),
  ('cust_100','100 paying customers','customers','paying_customers',100,110),
  ('cust_1000','1,000 paying customers','customers','paying_customers',1000,120),
  ('cust_10000','10,000 paying customers','customers','paying_customers',10000,130),
  ('aff_100','100 productive affiliates','operational','active_affiliates',100,210),
  ('agency_100','100 producing agencies','operational','producing_agencies',100,220),
  ('onb_80','80% onboarding completion','operational','onboarding_completion',0.8,230),
  ('gm_80','80% gross margin','operational','gross_margin',0.8,240),
  ('churn_2','Under 2% monthly logo churn','operational','logo_churn',0.02,250),
  ('nrr_110','Over 110% NRR','operational','nrr',1.10,260)
ON CONFLICT (key) DO NOTHING;

-- Operating plan — Mission → annual → quarterly → monthly → weekly → daily cascade.
CREATE TABLE IF NOT EXISTS cc_operating_plan (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level         text NOT NULL CHECK (level IN ('annual','quarterly','monthly','weekly','daily')),
  objective     text NOT NULL,
  metric_key    text,
  baseline      numeric,
  target        numeric,
  owner         text,
  start_date    date,
  due_date      date,
  status        text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','on_track','at_risk','off_track','done')),
  progress      numeric NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  notes         text,
  dependencies  text,
  growth_engine text CHECK (growth_engine IS NULL OR growth_engine IN ('direct','affiliate','whiteLabel','expansion')),
  playbook      text,
  source_classification text NOT NULL DEFAULT 'manual',
  confidence    text,
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_operating_plan_level_idx ON cc_operating_plan (level, due_date);

-- War Room — daily execution. Tasks are generated from real gaps (dedup via gap_key) or founder-created.
CREATE TABLE IF NOT EXISTS cc_war_room_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('today','week','month')),
  title         text NOT NULL,
  category      text NOT NULL DEFAULT 'custom',
  required_result numeric,
  actual        numeric,
  owner         text,
  deadline      date,
  priority      text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  expected_impact_cents bigint,
  playbook      text,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','dismissed')),
  dismiss_reason text,
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('generated','manual')),
  gap_key       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- One live generated task per gap (dedup); founder tasks have NULL gap_key.
CREATE UNIQUE INDEX IF NOT EXISTS cc_war_room_gap_key ON cc_war_room_tasks (gap_key) WHERE gap_key IS NOT NULL AND status IN ('open','in_progress');
CREATE INDEX IF NOT EXISTS cc_war_room_scope_idx ON cc_war_room_tasks (scope, status);

-- Scoreboard V2 — extend the weekly scoreboard into the company operating cadence.
ALTER TABLE cc_scoreboard ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE cc_scoreboard ADD COLUMN IF NOT EXISTS prior_value numeric;
ALTER TABLE cc_scoreboard ADD COLUMN IF NOT EXISTS source_classification text NOT NULL DEFAULT 'manual';
ALTER TABLE cc_scoreboard ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE cc_scoreboard ADD COLUMN IF NOT EXISTS linked_action_id uuid;
ALTER TABLE cc_scoreboard ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

ALTER TABLE cc_mission_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_operating_plan     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_war_room_tasks     ENABLE ROW LEVEL SECURITY;

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE cc_scoreboard DROP COLUMN IF EXISTS section, DROP COLUMN IF EXISTS prior_value,
--   DROP COLUMN IF EXISTS source_classification, DROP COLUMN IF EXISTS status,
--   DROP COLUMN IF EXISTS linked_action_id, DROP COLUMN IF EXISTS locked;
-- DROP TABLE IF EXISTS cc_war_room_tasks, cc_operating_plan, cc_mission_milestones CASCADE;
