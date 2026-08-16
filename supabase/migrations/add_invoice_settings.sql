-- ============================================================================
-- HOW THEY PAY YOU, AND WHEN IT IS DUE.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- Two things the invoice screen cannot say today, in one migration because they
-- are the same act: issuing an invoice is the moment both are fixed.
--
-- ── 1. PAYMENT INSTRUCTIONS ────────────────────────────────────────────────
--
-- Most businesses here are paid by bank transfer, Zelle, cheque or cash, so the
-- invoice has to carry the details. `studio_doc_settings.terms` already does this
-- for studio documents; `invoices` has no equivalent — no terms, no branding, no
-- per-tenant settings row of any kind.
--
-- TYPED ONCE, per tenant. Bank details do not change per invoice, and asking for
-- them on every one is how they end up inconsistent.
--
-- SNAPSHOTTED AT ISSUE onto the document, the way studio does. Changing your bank
-- details must not rewrite what a customer was already sent — an issued invoice is
-- a record of what was said, and that includes where the money was meant to go.
-- The snapshot column is therefore on `invoices`, and the settings row is only the
-- source it is copied from.
--
-- It is NOT terms and conditions. It is the line the customer acts on, and the
-- screen renders it at normal weight for that reason.
--
-- ── 2. WHEN IT IS DUE ──────────────────────────────────────────────────────
--
-- `invoices` has `issued_at` and nothing else, so the screen can show no due date,
-- no "due in 11 days", and no OVERDUE group. The reference draws all three.
--
-- `due_on` is a DATE, not a timestamp: "due 25 August" is a calendar fact, and a
-- timestamp would make it drift by timezone for no benefit. It is stamped at issue
-- from `net_days`, so it is a real agreed date on the document rather than
-- arithmetic the screen performs every time it renders — and it can be different
-- from the default when somebody agrees different terms.
--
-- NULLABLE, and null means "no date was agreed" — not "overdue". An invoice with
-- no due date is never late.
-- ============================================================================

CREATE TABLE IF NOT EXISTS invoice_settings (
  tenant_id            uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Free text, multi-line, rendered whitespace-preserved. Bank details are a shape
  -- as much as a string and reflowing them makes them unreadable.
  payment_instructions text,
  -- Net terms. 14 is not a legal default anywhere — it is a common one, and the
  -- owner can change it. Zero means due on issue.
  net_days             integer NOT NULL DEFAULT 14 CHECK (net_days >= 0 AND net_days <= 365),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE invoice_settings ENABLE ROW LEVEL SECURITY;
-- Server-only, like studio_doc_settings: every reader goes through the admin client
-- with an explicit tenant_id resolved from the session. No policy = no direct access.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS due_on               date,
  ADD COLUMN IF NOT EXISTS payment_instructions text;

COMMENT ON COLUMN invoices.due_on IS
  'When payment is due. Stamped at issue from invoice_settings.net_days. NULL means no date was agreed — such an invoice is never overdue.';
COMMENT ON COLUMN invoices.payment_instructions IS
  'How to pay, SNAPSHOTTED from invoice_settings at issue. Changing the settings must not rewrite what a customer was already sent.';
COMMENT ON COLUMN invoice_settings.payment_instructions IS
  'The source the snapshot is taken from. Typed once per tenant; bank details do not change per invoice.';

-- Every list read filters issued invoices by due date to find the overdue ones.
CREATE INDEX IF NOT EXISTS idx_invoices_due
  ON invoices (tenant_id, due_on)
  WHERE due_on IS NOT NULL;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect: the settings table, two new invoice columns, and the index.

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'invoice_settings' ORDER BY ordinal_position;

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'invoices' AND column_name IN ('due_on', 'payment_instructions');

SELECT indexname FROM pg_indexes WHERE indexname = 'idx_invoices_due';

-- Expect 0 rows: nobody has typed payment instructions yet.
SELECT count(*) AS tenants_with_invoice_settings FROM invoice_settings;

-- Expect all 4 with due_on NULL — the existing drafts predate this and are not overdue.
SELECT number, status, due_on FROM invoices ORDER BY number;
