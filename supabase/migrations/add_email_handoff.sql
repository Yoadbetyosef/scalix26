-- Migration: per-agent "acknowledge then hand off" mode for the email channel.
-- When true, the AI sends ONE auto-reply to a new email conversation, then sets
-- human_takeover so it never replies again in that thread. Default false → existing
-- agents keep replying to every email as before. Run in the Supabase SQL Editor.

ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS email_handoff_after_first_reply BOOLEAN DEFAULT false;
