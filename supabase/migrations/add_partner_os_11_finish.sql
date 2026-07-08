-- Migration: Partner OS — Finish (11). Stripe payout robustness, demo architecture (future-proof
-- for voice/call/recording/replay/engagement), demo→customer attribution, and scale indexes.
-- Idempotent. Run after 1–10.

-- ── Priority 1: payout robustness ──
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS retry_count int NOT NULL DEFAULT 0;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_payouts_status_created ON payouts(status, created_at DESC);

-- ── Priority 3: demo architecture (voice/call/recording/replay/engagement ready) ──
ALTER TABLE demos ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'text' CHECK (mode IN ('text','voice','call'));
ALTER TABLE demos ADD COLUMN IF NOT EXISTS engagement_score int NOT NULL DEFAULT 0;
ALTER TABLE demos ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;   -- future voice/call settings
ALTER TABLE demos ADD COLUMN IF NOT EXISTS recording_url text;                            -- future call/voice recording
ALTER TABLE demos ADD COLUMN IF NOT EXISTS chat_count int NOT NULL DEFAULT 0;

-- Granular per-prospect demo events (the backbone for engagement + attribution + future replay).
CREATE TABLE IF NOT EXISTS demo_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_id uuid NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  visitor_id uuid,
  event_type text NOT NULL,   -- view | chat | booked | signup | trial | paid | engagement
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_demo_events_demo ON demo_events(demo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demo_events_partner ON demo_events(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demo_events_type ON demo_events(demo_id, event_type);

-- Demo chat transcript = the "recording" for text demos (voice adds audio later via recording_url).
CREATE TABLE IF NOT EXISTS demo_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_id uuid NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  visitor_id uuid,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_demo_chat_demo ON demo_chat_messages(demo_id, created_at ASC);

-- ── Priority 4: demo → customer attribution ──
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS demo_id uuid REFERENCES demos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_demo ON referrals(demo_id) WHERE demo_id IS NOT NULL;

-- ── Scale: cached-stats-driven leaderboard + rank (avoid global scans) ──
CREATE INDEX IF NOT EXISTS idx_partner_stats_xp ON partner_stats(xp DESC);
CREATE INDEX IF NOT EXISTS idx_partner_stats_active ON partner_stats(active_customers DESC);

-- ── RLS ──
ALTER TABLE demo_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Partner demo events read" ON demo_events;
CREATE POLICY "Partner demo events read" ON demo_events FOR SELECT USING (partner_id = get_partner_id());
DROP POLICY IF EXISTS "Partner demo chat read" ON demo_chat_messages;
CREATE POLICY "Partner demo chat read" ON demo_chat_messages FOR SELECT USING (partner_id = get_partner_id());
