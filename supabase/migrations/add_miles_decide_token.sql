-- Migration: deciding a held draft from outside the app.
--
-- There is no push infrastructure in this product (no service worker, no VAPID, no device tokens),
-- so the notification is an SMS and an email carrying the FULL draft text, and the three actions live
-- behind a tokenised link — the same pattern app/approval/[token] already uses for order approvals.
--
-- The RAW token exists only in the message. Only its SHA-256 hash is stored, so a leaked database row
-- cannot be used to send a reply in the owner's name. Same helpers: lib/orders/approval-token.ts.
--
-- Run in the Supabase SQL Editor.

ALTER TABLE held_drafts ADD COLUMN IF NOT EXISTS decide_token_hash TEXT;
-- When the owner was told. Null = held but never announced, which is the state this stage exists to
-- make impossible; it is recorded so that failure is visible rather than assumed away.
ALTER TABLE held_drafts ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
ALTER TABLE held_drafts ADD COLUMN IF NOT EXISTS notify_error TEXT;

-- The lookup is by hash, and a hash belongs to exactly one draft.
CREATE UNIQUE INDEX IF NOT EXISTS held_drafts_decide_token_idx
  ON held_drafts (decide_token_hash) WHERE decide_token_hash IS NOT NULL;
