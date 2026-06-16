-- Migration: store email threading metadata on inbound messages so manual
-- (human-takeover) email replies thread correctly and land from the connected
-- address. Run in the Supabase SQL Editor.
--
-- email_message_id = the inbound email's RFC Message-ID (for In-Reply-To/References)
-- email_thread_id  = the Gmail thread id (for Gmail messages.send threadId)

ALTER TABLE messages ADD COLUMN IF NOT EXISTS email_message_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS email_thread_id TEXT;
