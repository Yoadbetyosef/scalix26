-- ============================================================================
-- Drop 1.1 — Webhook idempotency / replay protection
-- Run in the Supabase SQL editor (project bphpnlgjlklgwhewsnrm) before deploying.
-- One small table + a unique key. Signature verification stays the primary security
-- layer; this prevents provider RETRIES from processing the same event twice.
-- ============================================================================

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL,                 -- twilio | meta | resend
  event_key         text NOT NULL,                 -- provider event id or a stable fingerprint
  event_type        text,                          -- sms | voice | whatsapp | meta | email
  tenant_id         uuid,                          -- nullable (may be unknown at claim time)
  status            text NOT NULL DEFAULT 'processing',  -- processing | processed | failed
  first_received_at timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  expires_at        timestamptz DEFAULT (now() + interval '30 days'),
  UNIQUE (provider, event_key)                     -- the concurrency + dedup guard
);

CREATE INDEX IF NOT EXISTS processed_webhook_events_expires_idx ON processed_webhook_events (expires_at);

-- Server-only (all access is via the admin client from verified webhook routes).
ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;

-- Retention: a cleanup job deletes expired rows (added with cron security in the next drop). Manual:
--   DELETE FROM processed_webhook_events WHERE expires_at < now();
