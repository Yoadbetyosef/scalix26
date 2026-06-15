-- Migration: inbound email (AI auto-reply by email). Run in the Supabase SQL Editor.
-- NOTE: the per-tenant inbound address reuses the existing tenants.slug
-- ({slug}@mail.mylocksmithai.com) — no separate email_slug column needed.

ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS email_auto_reply BOOLEAN DEFAULT true;
ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS reply_from_email TEXT;

-- Schedule slot for the delayed auto-reply ("AI will reply in 2 min" / take-over window).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS email_reply_due_at TIMESTAMPTZ;

-- Allow channel='email' (channel was free-text; pin the allowed set including email).
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('sms', 'whatsapp', 'instagram', 'facebook', 'voice', 'email'));

CREATE INDEX IF NOT EXISTS idx_conversations_email_due ON conversations(email_reply_due_at)
  WHERE email_reply_due_at IS NOT NULL;
