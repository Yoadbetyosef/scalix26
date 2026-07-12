-- ============================================================================
-- White Label Prepaid Billing — Phase 2: immutable, fully-traceable usage events
-- Run in the Supabase SQL editor (project bphpnlgjlklgwhewsnrm). Idempotent.
--
-- Every metered event becomes an IMMUTABLE, self-describing record that can reconstruct the bill
-- forever. Pricing is SNAPSHOTTED at creation (markup_percent, partner_charge, pricing_rule_id,
-- billing_version) so future rate/markup changes never alter historical events. Settlement (which
-- events have been billed) is tracked in a SEPARATE append-only table — usage_events are never
-- overwritten after insert.
-- ============================================================================

-- ── Full traceability snapshot on usage_events (all additive) ─────────────────
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS customer_id     uuid;        -- end customer/contact (if applicable)
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS resource_id     text;        -- provider resource: call SID, message SID, completion id, …
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS markup_percent  numeric(6,2);-- SNAPSHOT of the markup that applied
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS currency        text NOT NULL DEFAULT 'usd';
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS billing_version int NOT NULL DEFAULT 1;   -- pricing-logic era
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS pricing_rule_id uuid REFERENCES provider_rates(id); -- rate-card row used (if any)
-- partner_charge_cents holds the SNAPSHOT partner charge; widen to numeric so sub-cent charges are
-- exact (the cron sums these fractional values and rounds ONCE per batch).
ALTER TABLE usage_events ALTER COLUMN partner_charge_cents TYPE numeric(20,6) USING partner_charge_cents::numeric;
-- provider now stores the REAL vendor (anthropic / twilio / deepgram / elevenlabs / resend / supabase);
-- it is admin-only (partners only ever see usage_category). cost_usd is the real provider_cost.

-- Determinism + idempotency: one event per (provider, resource_id). A retry can't double-meter.
CREATE UNIQUE INDEX IF NOT EXISTS usage_events_provider_resource_uniq
  ON usage_events (provider, resource_id) WHERE resource_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS usage_events_partner_idx ON usage_events (partner_id) WHERE partner_id IS NOT NULL;

-- ── Settlement tracking (append-only) — keeps usage_events immutable ───────────
-- One row per event once it has been rolled into a balance debit. usage_events themselves are never
-- updated; "which events are billed" lives here.
CREATE TABLE IF NOT EXISTS usage_settlements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_event_id  uuid NOT NULL UNIQUE REFERENCES usage_events(id) ON DELETE CASCADE,
  partner_id      uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  batch_key       text NOT NULL,                 -- the balance-debit idempotency key this event settled under
  charge_cents    bigint NOT NULL,               -- this event's rounded contribution (traceability)
  settled_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_settlements_partner_idx ON usage_settlements (partner_id);
ALTER TABLE usage_settlements ENABLE ROW LEVEL SECURITY;

-- ── Unsettled WL usage (the billing cron's work queue) ────────────────────────
CREATE OR REPLACE VIEW unsettled_wl_usage AS
SELECT ue.id, ue.partner_id, ue.tenant_id, ue.customer_id, ue.provider, ue.category,
       ue.resource_id, ue.units, ue.unit_type, ue.cost_usd, ue.markup_percent,
       ue.partner_charge_cents, ue.currency, ue.billing_version, ue.pricing_rule_id, ue.created_at
FROM usage_events ue
WHERE ue.partner_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM usage_settlements s WHERE s.usage_event_id = ue.id);

-- ============================================================================
-- Verify:
--   SELECT column_name FROM information_schema.columns WHERE table_name='usage_events'
--     AND column_name IN ('customer_id','resource_id','markup_percent','billing_version','pricing_rule_id');
--   SELECT count(*) FROM unsettled_wl_usage;   -- the cron's queue
-- Reproduce a bill from immutable events (per partner+category, historical pricing preserved):
--   SELECT partner_id, category, round(sum(partner_charge_cents)) AS charge_cents
--   FROM usage_events WHERE partner_id IS NOT NULL GROUP BY 1,2;
-- ============================================================================
