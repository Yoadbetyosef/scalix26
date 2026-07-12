-- ============================================================================
-- White Label Prepaid Billing — Phase 2b: voice event metadata
-- Run in the Supabase SQL editor (project bphpnlgjlklgwhewsnrm). Idempotent.
--
-- Adds a metadata jsonb to usage_events so voice (and any) events carry full provider
-- request/event context for traceability: call direction, status, ParentCallSid, from/to,
-- raw duration, and which leg (parent/child). usage_events stay immutable — this is set at insert.
-- ============================================================================

ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS metadata jsonb;

-- (Voice provider costs are computed from lib/cost/rates.ts constants and snapshotted onto the
--  immutable event, exactly like AI — no rate-card row lookup needed; pricing_rule_id stays null.)
