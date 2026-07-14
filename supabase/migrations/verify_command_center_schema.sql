-- ============================================================================
-- CEO Command Center — READ-ONLY schema verification (no writes, no DDL)
-- Run in the SQL editor of project bphpnlgjlklgwhewsnrm.
-- Query A ("DRIFT REPORT") must return ZERO rows for a clean schema.
-- Query B ("INVENTORY") is informational — eyeball it if A flags anything.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- QUERY A — DRIFT REPORT  (expected result: 0 rows = PASS)
-- ─────────────────────────────────────────────────────────────────────────
WITH
expected_tables(tbl) AS (VALUES
  ('cc_configs'),('cc_assumptions'),('cc_actuals'),('cc_scenarios'),('cc_snapshots'),
  ('cc_expense_items'),('cc_headcount'),('cc_targets'),('cc_scoreboard'),('cc_change_log'),
  ('cc_metric_definitions'),('cc_customer_health_snapshots'),('cc_lifecycle_events'),
  ('cc_churn_reasons'),('cc_onboarding_overlay'),('cc_metric_snapshots')
),
-- unique index/constraint column-sets we require (sorted)
expected_unique(tbl, cols) AS (VALUES
  ('cc_assumptions', ARRAY['category','config_id','effective_from','key']),
  ('cc_actuals',     ARRAY['metric_key','month']),
  ('cc_targets',     ARRAY['metric_key','period']),
  ('cc_scoreboard',  ARRAY['engine','metric_key','week_start']),
  ('cc_customer_health_snapshots', ARRAY['snapshot_date','tenant_id']),
  ('cc_lifecycle_events', ARRAY['idempotency_key']),
  ('cc_metric_snapshots', ARRAY['metric_key','period','snapshot_type']),
  ('cc_metric_definitions', ARRAY['metric_key']),
  ('cc_configs', ARRAY['is_active'])   -- partial unique index cc_configs_single_active
),
-- named non-unique indexes we require
expected_index(idx) AS (VALUES
  ('cc_assumptions_config_idx'),('cc_snapshots_scenario_idx'),('cc_change_log_entity_idx'),
  ('cc_lifecycle_events_tenant_idx'),('cc_churn_reasons_tenant_idx'),('cc_configs_single_active')
),
-- foreign keys we require: child.col -> parent
expected_fk(child, col, parent) AS (VALUES
  ('cc_assumptions','config_id','cc_configs'),
  ('cc_scenarios','base_config_id','cc_configs'),
  ('cc_snapshots','scenario_id','cc_scenarios'),
  ('cc_expense_items','scenario_id','cc_scenarios'),
  ('cc_headcount','scenario_id','cc_scenarios')
),
-- check constraints must contain these tokens (guards the enum sets)
expected_check(tbl, token) AS (VALUES
  ('cc_configs','conservative'),('cc_actuals','derived'),
  ('cc_expense_items','usage'),('cc_headcount','contractor'),
  ('cc_scoreboard','expansion'),('cc_customer_health_snapshots','critical'),
  ('cc_lifecycle_events','chargeback_reversed'),('cc_lifecycle_events','subscription_changed'),
  ('cc_lifecycle_events','subscription_created'),('cc_onboarding_overlay','training_required'),
  ('cc_onboarding_overlay','medium'),('cc_metric_snapshots','monthly')
),
-- actual unique index column-sets in public
actual_unique AS (
  SELECT t.relname AS tbl, (SELECT array_agg(a.attname ORDER BY a.attname)
           FROM unnest(i.indkey) k(attnum)
           JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum) AS cols
  FROM pg_index i
  JOIN pg_class t  ON t.oid=i.indrelid
  JOIN pg_namespace n ON n.oid=t.relnamespace AND n.nspname='public'
  WHERE i.indisunique AND t.relname LIKE 'cc_%'
)
-- (1) missing tables
SELECT 'MISSING TABLE' AS problem, tbl AS detail FROM expected_tables et
WHERE NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                  WHERE n.nspname='public' AND c.relname=et.tbl)
UNION ALL
-- (2) RLS not enabled
SELECT 'RLS DISABLED', et.tbl FROM expected_tables et
JOIN pg_class c ON c.relname=et.tbl
JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
WHERE c.relrowsecurity = false
UNION ALL
-- (3) unexpected RLS policy present (we require ZERO policies — server-only lockdown)
SELECT 'UNEXPECTED RLS POLICY', p.tablename||'.'||p.policyname
FROM pg_policies p WHERE p.schemaname='public' AND p.tablename LIKE 'cc_%'
UNION ALL
-- (4) missing required unique index/constraint (by column-set)
SELECT 'MISSING UNIQUE', eu.tbl||'('||array_to_string(eu.cols,',')||')'
FROM expected_unique eu
WHERE NOT EXISTS (SELECT 1 FROM actual_unique au WHERE au.tbl=eu.tbl AND au.cols=eu.cols)
UNION ALL
-- (5) missing named index
SELECT 'MISSING INDEX', ei.idx FROM expected_index ei
WHERE NOT EXISTS (SELECT 1 FROM pg_indexes p WHERE p.schemaname='public' AND p.indexname=ei.idx)
UNION ALL
-- (6) missing foreign key
SELECT 'MISSING FK', ef.child||'.'||ef.col||' -> '||ef.parent
FROM expected_fk ef
WHERE NOT EXISTS (
  SELECT 1 FROM pg_constraint con
  JOIN pg_class ch ON ch.oid=con.conrelid AND ch.relname=ef.child
  JOIN pg_class pa ON pa.oid=con.confrelid AND pa.relname=ef.parent
  JOIN pg_attribute a ON a.attrelid=ch.oid AND a.attnum=ANY(con.conkey) AND a.attname=ef.col
  WHERE con.contype='f')
UNION ALL
-- (7) missing/insufficient check-constraint token
SELECT 'MISSING CHECK TOKEN', ec.tbl||' ~ '||ec.token
FROM expected_check ec
WHERE NOT EXISTS (
  SELECT 1 FROM pg_constraint con
  JOIN pg_class c ON c.oid=con.conrelid AND c.relname=ec.tbl
  JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
  WHERE con.contype='c' AND pg_get_constraintdef(con.oid) LIKE '%'||ec.token||'%')
ORDER BY 1,2;

-- ─────────────────────────────────────────────────────────────────────────
-- QUERY B — INVENTORY (informational). Expected: 16 tables, all rls_enabled=t,
-- policies=0, and triggers=0 (this schema uses DEFAULT now()/app code, no triggers).
-- ─────────────────────────────────────────────────────────────────────────
SELECT c.relname AS table,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies,
       (SELECT count(*) FROM pg_index i WHERE i.indrelid=c.oid) AS indexes,
       (SELECT count(*) FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype='f') AS fks,
       (SELECT count(*) FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype='c') AS checks,
       (SELECT count(*) FROM pg_trigger tg WHERE tg.tgrelid=c.oid AND NOT tg.tgisinternal) AS triggers
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
WHERE c.relkind='r' AND c.relname LIKE 'cc_%'
ORDER BY c.relname;
