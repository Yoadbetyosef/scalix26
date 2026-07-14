-- ============================================================================
-- CEO Command Center — Phase 3A completion: onboarding overlay fields + lifecycle-event instrumentation
-- Run AFTER add_command_center_3.sql in the Supabase SQL editor. Idempotent (additive).
-- ============================================================================

-- 1) Onboarding operational overlay — richer manual fields (owner/SLA/priority/next-action/resolution).
ALTER TABLE cc_onboarding_overlay ADD COLUMN IF NOT EXISTS blocker_notes  text;
ALTER TABLE cc_onboarding_overlay ADD COLUMN IF NOT EXISTS sla_due_date   date;
ALTER TABLE cc_onboarding_overlay ADD COLUMN IF NOT EXISTS priority       text;
ALTER TABLE cc_onboarding_overlay ADD COLUMN IF NOT EXISTS next_action    text;
ALTER TABLE cc_onboarding_overlay ADD COLUMN IF NOT EXISTS follow_up_date date;
ALTER TABLE cc_onboarding_overlay ADD COLUMN IF NOT EXISTS status         text;
ALTER TABLE cc_onboarding_overlay ADD COLUMN IF NOT EXISTS resolution_note text;
ALTER TABLE cc_onboarding_overlay DROP CONSTRAINT IF EXISTS cc_onboarding_overlay_priority_check;
ALTER TABLE cc_onboarding_overlay ADD CONSTRAINT cc_onboarding_overlay_priority_check
  CHECK (priority IS NULL OR priority IN ('low','medium','high'));

-- 2) Lifecycle events — Stripe event id for idempotency, event timestamp, and state transitions.
ALTER TABLE cc_lifecycle_events ADD COLUMN IF NOT EXISTS source_event_id text;
ALTER TABLE cc_lifecycle_events ADD COLUMN IF NOT EXISTS previous_state  text;
ALTER TABLE cc_lifecycle_events ADD COLUMN IF NOT EXISTS new_state       text;

-- Extend the kind set (chargeback_reversed, subscription_changed fallback, subscription re-created).
ALTER TABLE cc_lifecycle_events DROP CONSTRAINT IF EXISTS cc_lifecycle_events_kind_check;
ALTER TABLE cc_lifecycle_events ADD CONSTRAINT cc_lifecycle_events_kind_check
  CHECK (kind IN ('cancellation','failed_payment','recovery','downgrade','upgrade','pause','reactivation',
                  'refund','chargeback','chargeback_reversed','subscription_changed','subscription_created'));

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE cc_onboarding_overlay DROP COLUMN IF EXISTS blocker_notes, DROP COLUMN IF EXISTS sla_due_date,
--   DROP COLUMN IF EXISTS priority, DROP COLUMN IF EXISTS next_action, DROP COLUMN IF EXISTS follow_up_date,
--   DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS resolution_note;
-- ALTER TABLE cc_lifecycle_events DROP COLUMN IF EXISTS source_event_id, DROP COLUMN IF EXISTS previous_state, DROP COLUMN IF EXISTS new_state;
