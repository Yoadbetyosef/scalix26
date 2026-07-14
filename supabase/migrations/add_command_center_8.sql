-- ============================================================================
-- CEO Command Center — Plan (unified planning). One founder-set annual goal + its assumptions. The cascade
-- (monthly/weekly/daily) is DERIVED from this + reality + persisted assumptions; nothing derived is stored.
-- Weekly targets reuse cc_scoreboard; today's actions reuse cc_war_room_tasks. Additive, idempotent, RLS.
-- Run AFTER add_command_center_7.sql.
-- ============================================================================
CREATE TABLE IF NOT EXISTS cc_plan (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_metric       text NOT NULL DEFAULT 'arr_cents' CHECK (primary_metric IN ('arr_cents','mrr_cents','paying_customers','revenue','profit')),
  annual_target        numeric NOT NULL DEFAULT 0,
  start_date           date NOT NULL DEFAULT current_date,
  target_date          date,
  arpu_target_cents    bigint,              -- null → use current (Derived Actual) ARPU
  monthly_goal_override numeric,            -- null → derived from the cascade
  -- Editable growth-engine allocation of the customer gap (fractions; NOT hardcoded). Default 45/35/20/0.
  alloc_direct         numeric NOT NULL DEFAULT 0.45 CHECK (alloc_direct >= 0),
  alloc_affiliate      numeric NOT NULL DEFAULT 0.35 CHECK (alloc_affiliate >= 0),
  alloc_whitelabel     numeric NOT NULL DEFAULT 0.20 CHECK (alloc_whitelabel >= 0),
  alloc_expansion      numeric NOT NULL DEFAULT 0.00 CHECK (alloc_expansion >= 0),
  mode                 text NOT NULL DEFAULT 'simple' CHECK (mode IN ('simple','advanced')),
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active')),
  is_active            boolean NOT NULL DEFAULT true,
  updated_by           text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
-- At most one active plan.
CREATE UNIQUE INDEX IF NOT EXISTS cc_plan_single_active ON cc_plan (is_active) WHERE is_active;

-- Engine allocation is stored as fractions that MUST total exactly 1 (the app normalizes % → fractions).
ALTER TABLE cc_plan DROP CONSTRAINT IF EXISTS cc_plan_allocations_total_check;
ALTER TABLE cc_plan ADD CONSTRAINT cc_plan_allocations_total_check
  CHECK (abs(alloc_direct + alloc_affiliate + alloc_whitelabel + alloc_expansion - 1) < 0.000001);

ALTER TABLE cc_plan ENABLE ROW LEVEL SECURITY;

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS cc_plan CASCADE;
