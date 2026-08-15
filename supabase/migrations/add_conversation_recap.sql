-- ============================================================================
-- WHAT HAPPENED — a written recap, in its own column.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- ── WHY NOT `summary` ──────────────────────────────────────────────────────
--
-- `conversations.summary` already holds two unrelated things:
--
--   • On email, it is the SUBJECT LINE. app/api/webhooks/email/inbound writes
--     it on every inbound message, and app/api/mailbox/poll does the same.
--   • It is also READ BACK as the subject: app/api/conversations/[id]/send
--     uses `conv.summary` as `subjectBase` when the owner replies by email.
--     A reply lands in the customer's mailbox under "Re: <that value>".
--   • On SMS and social, lib/anthropic/pipeline's generateConversationSummary
--     writes a 2–3 sentence recap into the same column.
--
-- So widening the recap writer to cover email — which is the point of this
-- change — would overwrite the subject line with a paragraph, and the next
-- owner reply would go out with a paragraph in its Subject header. That is a
-- customer-visible defect, not a tidy-up. Hence a second column rather than a
-- reinterpretation of the first: the email path keeps writing the subject
-- exactly where it does today and nothing about it changes.
--
-- ── WHAT READS IT ──────────────────────────────────────────────────────────
--
-- /v2's conversation screen reads `recap` ONLY. Null means the section is
-- absent — a screen must never assemble a recap from the last message, which
-- would be it asserting something nobody wrote.
--
-- `recap_at` is not decoration: the writer runs ONCE per conversation, at
-- completion, and this is how it knows. It is also what makes the backfill
-- re-runnable without paying for the same conversation twice.
-- ============================================================================

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS recap    text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS recap_at timestamptz;

COMMENT ON COLUMN conversations.recap IS
  'A 2-3 sentence written account of what happened, generated once when the conversation completes. Distinct from `summary`, which on email holds the subject line and is read back as the outbound Subject header.';
COMMENT ON COLUMN conversations.recap_at IS
  'When the recap was generated. Non-null means the writer has already run for this conversation and must not run again.';

-- The writer picks up completed conversations that have not been written yet.
-- Partial, so it indexes only the rows the query actually looks for.
CREATE INDEX IF NOT EXISTS idx_conversations_recap_pending
  ON conversations (tenant_id, updated_at DESC)
  WHERE recap_at IS NULL;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect: two rows (recap, recap_at), and the index present.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'conversations' AND column_name IN ('recap', 'recap_at')
ORDER BY column_name;

SELECT indexname FROM pg_indexes
WHERE tablename = 'conversations' AND indexname = 'idx_conversations_recap_pending';
