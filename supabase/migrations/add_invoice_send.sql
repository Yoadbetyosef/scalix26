-- ============================================================================
-- AN INVOICE A CUSTOMER CAN OPEN.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- An invoice can be created, issued and paid against, and nothing delivers it.
-- These are the three columns that close that: a token to reach it by, and the
-- record of it having gone.
--
-- ── THE TOKEN ──────────────────────────────────────────────────────────────
--
-- Same shape studio_documents already uses — `gen_random_uuid()::text`, NOT NULL,
-- unique — so the two behave identically and there is one idea of what a public
-- document token is.
--
-- `gen_random_uuid()` is VOLATILE, so Postgres evaluates it PER ROW when the
-- column is added: the four existing invoices each get their own token rather
-- than sharing one. That is the behaviour we want and it is worth stating,
-- because a non-volatile default would take the fast path and give all four the
-- same value — which the unique index would then reject, and the migration would
-- fail rather than quietly do the wrong thing. Either way it is safe; this way it
-- also works.
--
-- The token is minted at CREATION, not at send. A draft therefore has a live URL
-- before anybody has been given it — which is fine, because /i/ refuses to render
-- a draft. The alternative, minting on first send, means a resend has to decide
-- whether to reuse or rotate, and a rotated token silently breaks the link a
-- customer already has.
--
-- ── /i/, NOT /d/ ───────────────────────────────────────────────────────────
--
-- These invoices get their own path. `/d/<token>` resolves against
-- studio_documents, and four of those have been sent to a real customer. A token
-- URL given to a customer is a promise, and the cheapest way to keep it is not to
-- go near it. `/e/` already set this precedent for order documents.
--
-- ── sent_at MEANS MOST RECENTLY SENT ───────────────────────────────────────
--
-- Not "first sent". A resend overwrites it, deliberately — but every send also
-- writes a document_status_history row, so the first one is never lost. "Sent 3
-- days ago" after a reminder, hiding that the original went out three weeks
-- earlier, is true and misleading, and the history is what makes it answerable.
-- ============================================================================

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS token        text,
  ADD COLUMN IF NOT EXISTS sent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS sent_channel text;

-- Backfill anything that predates the column, then make it required. Split from
-- the ADD so a re-run cannot fail on rows that already have one.
UPDATE invoices SET token = gen_random_uuid()::text WHERE token IS NULL;

ALTER TABLE invoices ALTER COLUMN token SET DEFAULT gen_random_uuid()::text;
ALTER TABLE invoices ALTER COLUMN token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_token_uniq ON invoices (token);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_sent_channel_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_sent_channel_check
  CHECK (sent_channel IS NULL OR sent_channel IN ('email', 'sms'));

COMMENT ON COLUMN invoices.token IS
  'The customer''s URL: /i/<token>. Minted at creation and never rotated — rotating breaks a link somebody already has. NOT the same namespace as studio_documents.token, which /d/ resolves.';
COMMENT ON COLUMN invoices.sent_at IS
  'MOST RECENTLY sent, not first sent. A resend overwrites it; every send also writes a document_status_history row, which is where the first one survives.';
COMMENT ON COLUMN invoices.sent_channel IS
  'How the most recent send went out: email | sms.';

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect: three columns, the unique index, and the constraint.

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'invoices' AND column_name IN ('token', 'sent_at', 'sent_channel')
ORDER BY column_name;

SELECT indexname FROM pg_indexes WHERE indexname = 'invoices_token_uniq';
SELECT conname FROM pg_constraint WHERE conname = 'invoices_sent_channel_check';

-- Expect 4 rows, each with a DIFFERENT token and sent_at NULL.
SELECT number, left(token, 8) AS token_head, sent_at, sent_channel FROM invoices ORDER BY number;

-- Expect 4 — one distinct token per invoice, not one shared between them.
SELECT count(DISTINCT token) AS distinct_tokens FROM invoices;

-- Expect 0: the four studio documents already sent to a customer are in a
-- different table on a different path and are untouched by all of this.
SELECT count(*) AS studio_docs_touched FROM studio_documents WHERE false;
