-- ============================================================================
-- CEO Command Center — Phase 2b hardening: single-active-config guard (concurrency)
-- Run AFTER add_command_center_1.sql in the Supabase SQL editor. Idempotent.
--
-- Guarantees at most ONE active config, so two concurrent first-loads can't create duplicate Base configs
-- (getOrCreateBaseConfig catches the losing insert and returns the winner).
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS cc_configs_single_active ON cc_configs (is_active) WHERE is_active;

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS cc_configs_single_active;
