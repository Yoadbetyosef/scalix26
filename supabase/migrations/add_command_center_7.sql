-- ============================================================================
-- CEO Command Center — Phase 3E: actual/manual cost items (Costs page)
-- Run AFTER add_command_center_6.sql. Additive, idempotent, reversible, RLS-locked (server-only).
-- Forecast costs come from the forecast engine; ACTUAL/manual costs live here (kept separate from forecast).
-- ============================================================================
CREATE TABLE IF NOT EXISTS cc_actual_costs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_type     text NOT NULL CHECK (cost_type IN ('cogs','opex')),
  category      text NOT NULL,
  vendor        text,
  amount_cents  bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  recurrence    text NOT NULL DEFAULT 'monthly' CHECK (recurrence IN ('one_time','monthly','annual')),
  start_date    date NOT NULL DEFAULT current_date,
  end_date      date,
  notes         text,
  owner         text,
  source_classification text NOT NULL DEFAULT 'manual',
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_actual_costs_type_idx ON cc_actual_costs (cost_type, category);

ALTER TABLE cc_actual_costs ENABLE ROW LEVEL SECURITY;

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS cc_actual_costs CASCADE;
