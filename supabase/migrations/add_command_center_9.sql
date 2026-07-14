-- ============================================================================
-- CEO Command Center — Plan working-days calendar. Editable working days/week (default 7 for the founder),
-- operating week boundary, and timezone. The daily pace uses ACTUAL remaining working days — no hardcoded
-- divisor. Additive, idempotent, RLS already on cc_plan. Run AFTER add_command_center_8.sql.
-- ============================================================================
ALTER TABLE cc_plan ADD COLUMN IF NOT EXISTS working_days_per_week int NOT NULL DEFAULT 7 CHECK (working_days_per_week BETWEEN 1 AND 7);
ALTER TABLE cc_plan ADD COLUMN IF NOT EXISTS week_start_day int NOT NULL DEFAULT 1 CHECK (week_start_day BETWEEN 0 AND 6); -- 0=Sun..6=Sat; default 1=Mon
ALTER TABLE cc_plan ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/New_York';

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE cc_plan DROP COLUMN IF EXISTS working_days_per_week, DROP COLUMN IF EXISTS week_start_day, DROP COLUMN IF EXISTS timezone;
