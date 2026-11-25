-- ============================================================================
-- QUOTES — what a quote needs that an invoice already has, plus its own two dates.
--
-- Run in the Supabase SQL editor (project bphpnlgjlklgwhewsnrm). Additive only: seven nullable
-- columns on `quotes`, a table no screen read or wrote before this. Nothing existing changes.
--
--   token          the customer's URL, /quote/<token>. Minted at creation, never rotated.
--   sent_at        most recently sent. NULL = never sent, which is what "draft" means for a quote.
--   sent_channel   email | sms
--   valid_until    the date the offer lapses. NULL = open-ended.
--   accepted_at    when the customer pressed Accept. status moves to 'accepted' with it.
--   discount_kind / discount_value   the same pair invoices carry (add_invoice_discount.sql).
--
-- A QUOTE STAYS status='draft' UNTIL IT IS ACCEPTED, sent or not. That is deliberate:
-- trg_lines_only_on_draft freezes the lines of anything not in draft, and a quote that has been sent
-- is exactly the thing its owner needs to be able to revise and send again.
-- ============================================================================

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS token          text,
  ADD COLUMN IF NOT EXISTS sent_at        timestamptz,
  ADD COLUMN IF NOT EXISTS sent_channel   text,
  ADD COLUMN IF NOT EXISTS valid_until    date,
  ADD COLUMN IF NOT EXISTS accepted_at    timestamptz,
  ADD COLUMN IF NOT EXISTS discount_kind  text,
  ADD COLUMN IF NOT EXISTS discount_value numeric;

UPDATE quotes SET token = gen_random_uuid()::text WHERE token IS NULL;
ALTER TABLE quotes ALTER COLUMN token SET DEFAULT gen_random_uuid()::text;
ALTER TABLE quotes ALTER COLUMN token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS quotes_token_uniq ON quotes (token);

-- Verify: expect the seven rows.
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_name = 'quotes' AND column_name IN ('token','sent_at','sent_channel','valid_until','accepted_at','discount_kind','discount_value')
ORDER BY column_name;
