-- Migration: Partner OS V3 (8) — Gamification engine (XP, levels, achievements, streaks).
-- XP is an append-only event ledger; total XP = sum(xp). One-time awards (missions/achievements)
-- are deduped via unique_key. Level, global rank, and streak are cached on partner_stats.
-- Idempotent. Run after 1–7.

CREATE TABLE IF NOT EXISTS partner_xp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL,                 -- 'first_link' | 'demo_created' | 'customer_paid' | 'ach:first_customer' ...
  xp int NOT NULL DEFAULT 0,
  label text,                         -- human label for achievements ('Certified Partner')
  unique_key text,                    -- set for one-time awards; dedupes retries
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_xp_unique_key ON partner_xp_events(unique_key) WHERE unique_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partner_xp_partner ON partner_xp_events(partner_id, created_at DESC);

-- Cached gamification state on the dashboard stats row.
ALTER TABLE partner_stats ADD COLUMN IF NOT EXISTS xp bigint NOT NULL DEFAULT 0;
ALTER TABLE partner_stats ADD COLUMN IF NOT EXISTS level text;
ALTER TABLE partner_stats ADD COLUMN IF NOT EXISTS global_rank int;
ALTER TABLE partner_stats ADD COLUMN IF NOT EXISTS streak_days int NOT NULL DEFAULT 0;

ALTER TABLE partner_xp_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Partner xp read" ON partner_xp_events;
CREATE POLICY "Partner xp read" ON partner_xp_events FOR SELECT USING (partner_id = get_partner_id());
