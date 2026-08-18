-- THE DUPLICATE BACKSTOP, ACROSS BOTH MONEY-OUT TABLES.
--
-- `supplier_invoices` has carried `file_hash` since add_landed_cost_invoices.sql,
-- and findDuplicate() uses it to warn that a document has been here before.
-- `expenses` has never had one, so photographing the same receipt twice has been
-- completely silent — two rows, two amounts, one piece of paper.
--
-- Both tables store their files in the SAME bucket (see lib/expenses/store.ts,
-- which re-exports INVOICE_BUCKET rather than opening a second one), so a hash on
-- this table makes the cross-table check two lookups rather than a new subsystem.
--
-- ── WHAT THIS COLUMN IS FOR, AND WHAT IT IS NOT ────────────────────────────────
--
-- It WARNS. It never blocks. Re-uploading after a failed read is legitimate and
-- common, and the owner is the one who knows which of the two they meant — the
-- same rule findDuplicate already follows, and the reason that function returns a
-- warning rather than an error.
--
-- It also only catches the BYTE-IDENTICAL file. The same invoice photographed
-- twice, or re-rendered by an email client, hashes differently. What catches
-- those is supplier plus invoice number, which does not exist until the document
-- has been read — which is why the duplicate check runs after extraction and not
-- at the picker.
--
-- NULLABLE, and stays nullable. Every expense typed by hand has no file at all,
-- and every row written before this migration has no hash. A NOT NULL column here
-- would mean inventing a value for "there was no document", which is a fact, not
-- a missing one.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS file_hash text;

COMMENT ON COLUMN expenses.file_hash IS
  'SHA-256 of the receipt as uploaded. NULL when the expense was typed by hand or predates the column. Used to warn about a re-upload, never to block one.';

-- Partial: only rows that actually have one. A tenant with 400 hand-typed
-- expenses and 3 photographed ones indexes 3 rows.
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_file_hash
  ON expenses (tenant_id, file_hash)
  WHERE file_hash IS NOT NULL;

-- NO UNIQUE CONSTRAINT, deliberately. A unique index would turn "you have
-- uploaded this before" from a sentence the owner can overrule into a write that
-- fails — and there are real cases for two rows off one file: a receipt covering
-- two months split across two entries, or a genuine second purchase where the
-- supplier reissued the identical PDF.
