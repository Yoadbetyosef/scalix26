-- Phase A (A2 + A3): SMS delivery visibility + Messaging Service send config.
-- Additive only — safe to run more than once. Run in the Supabase SQL Editor.

-- ── A2: delivery visibility on messages ──────────────────────────────────────
-- Twilio statusCallback writes the async delivery outcome here so an SMS can no
-- longer fail silently (e.g. 30034). provider_sid links our row to the Twilio SID.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_status TEXT;  -- queued|sent|delivered|undelivered|failed
ALTER TABLE messages ADD COLUMN IF NOT EXISTS error_code TEXT;        -- e.g. 30034
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_sid TEXT;      -- Twilio Message SID (SMxxxx)
CREATE INDEX IF NOT EXISTS idx_messages_provider_sid ON messages(provider_sid);

-- ── A3: per-number Messaging Service / A2P send config on channels ────────────
-- When an SMS channel is A2P-registered we route its outbound through its
-- Messaging Service (campaign association) instead of sending raw from the number.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS messaging_service_sid TEXT;
-- pending_verification (default) | active | failed
ALTER TABLE channels ADD COLUMN IF NOT EXISTS sms_status TEXT NOT NULL DEFAULT 'pending_verification';

-- ── One-off config: live paying customer TG Jewellers (+14432220794) ─────────
-- Her number is already the sole sender in approved Messaging Service
-- MGcd31391b8491ad528897351119285a8c. Mark her SMS channel active + linked so
-- outbound routes through the service (campaign association) once the env flag
-- SMS_VIA_MESSAGING_SERVICE=true is set. Data/config only — NOT a number change.
-- Idempotent.
UPDATE channels
SET sms_status = 'active',
    messaging_service_sid = 'MGcd31391b8491ad528897351119285a8c'
WHERE twilio_number = '+14432220794' AND type = 'sms';
