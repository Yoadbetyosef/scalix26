-- ============================================================================
-- CEO Command Center — Phase 3A: lifecycle / retention / onboarding executive layer
-- Run AFTER add_command_center_2.sql in the Supabase SQL editor. Idempotent.
--
-- Executive OVERLAY only — references source-of-truth tables (tenants/conversations/...) by id; never
-- copies message/conversation/PII content. All tables RLS-locked (server-only, founder-gated code).
-- ============================================================================

-- Governance overlay for the canonical metric registry (targets/thresholds/reliability boundary).
CREATE TABLE IF NOT EXISTS cc_metric_definitions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key         text NOT NULL UNIQUE,
  target_value       numeric,
  warning_threshold  numeric,
  critical_threshold numeric,
  reliable_from      date,
  updated_by         text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Per-tenant health snapshots (score + components + factors — counts/status only, no PII).
CREATE TABLE IF NOT EXISTS cc_customer_health_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  snapshot_date date NOT NULL,
  overall       int NOT NULL,
  bucket        text NOT NULL CHECK (bucket IN ('healthy','watch','at_risk','critical')),
  lifecycle     text,
  components     jsonb,
  factors        jsonb,
  taken_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, snapshot_date)
);

-- Going-forward lifecycle event source (cancellation/failed payment/etc.). Event-sourced from reliable_from.
CREATE TABLE IF NOT EXISTS cc_lifecycle_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid,
  kind            text NOT NULL CHECK (kind IN ('cancellation','failed_payment','recovery','downgrade','upgrade','pause','reactivation','refund','chargeback')),
  mrr_cents       bigint,
  source          text NOT NULL DEFAULT 'stripe',
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  idempotency_key text UNIQUE,
  metadata        jsonb
);
CREATE INDEX IF NOT EXISTS cc_lifecycle_events_tenant_idx ON cc_lifecycle_events (tenant_id, occurred_at DESC);

-- Founder/admin churn-reason capture (Manual for now; connects to a cancellation flow later).
CREATE TABLE IF NOT EXISTS cc_churn_reasons (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  churned_at          date,
  mrr_cents           bigint,
  primary_reason      text NOT NULL,
  secondary_reasons   jsonb,
  notes               text,
  save_attempted      boolean NOT NULL DEFAULT false,
  save_outcome        text,
  reactivation_outcome text,
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_churn_reasons_tenant_idx ON cc_churn_reasons (tenant_id);

-- Manual operational overlay for onboarding (owner/blocker/SLA); the observed stage is derived live.
CREATE TABLE IF NOT EXISTS cc_onboarding_overlay (
  tenant_id   uuid PRIMARY KEY,
  owner       text,
  blocker     text CHECK (blocker IS NULL OR blocker IN ('customer_unresponsive','phone_verification','twilio_approval','meta_approval','google_approval','missing_business_info','website_scan_failure','integration_failure','payment_issue','product_bug','internal_setup_delay','training_required','unknown')),
  sla_status  text,
  manual_stage text,
  notes       text,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Immutable executive metric snapshots (daily/weekly/monthly); lockable.
CREATE TABLE IF NOT EXISTS cc_metric_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type text NOT NULL CHECK (snapshot_type IN ('daily','weekly','monthly')),
  period        text NOT NULL,           -- e.g. '2026-07-14', '2026-W29', '2026-07'
  metric_key    text NOT NULL,
  value         numeric,
  source        text,
  coverage      numeric,
  taken_at      timestamptz NOT NULL DEFAULT now(),
  locked        boolean NOT NULL DEFAULT false,
  UNIQUE (snapshot_type, period, metric_key)
);

ALTER TABLE cc_metric_definitions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_customer_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_lifecycle_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_churn_reasons             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_onboarding_overlay        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_metric_snapshots          ENABLE ROW LEVEL SECURITY;

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS cc_metric_snapshots, cc_onboarding_overlay, cc_churn_reasons, cc_lifecycle_events,
--   cc_customer_health_snapshots, cc_metric_definitions CASCADE;
