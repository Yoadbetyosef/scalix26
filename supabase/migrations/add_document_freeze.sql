-- ============================================================================
-- AN ISSUED DOCUMENT IS FROZEN.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- ── WHY A TRIGGER AND NOT ONLY A CODE GUARD ────────────────────────────────
--
-- lib/core/documents.ts refuses to add a line to a document that is not a draft,
-- and today it is the only writer of sales_document_lines. That is a rule held by
-- one function's good behaviour.
--
-- An invoice's total is a promise made to somebody on a date. A total that can
-- still move afterwards is not a promise — and the way it moves is never a
-- deliberate act, it is a second writer nobody remembered: a /v2 screen, a repair
-- script, a future conversion path. The guard belongs where it cannot be walked
-- around.
--
-- ── WHAT IT ALLOWS ─────────────────────────────────────────────────────────
--
-- Everything on a DRAFT, unchanged. Nothing on anything else — no insert, no
-- update, no delete. Deletes are included deliberately: removing a line from an
-- issued invoice changes its total exactly as adding one does.
--
-- It reads the parent's status from the document's own table, chosen by
-- document_type, so a line can never be freer than its header.
--
-- ── THE ONE ESCAPE, NAMED ──────────────────────────────────────────────────
--
-- There is none. If an issued document is wrong, the answer is a credit note or a
-- new document — not editing history. That is an accounting rule before it is a
-- software one, and building an override now would make it the thing people reach
-- for instead.
-- ============================================================================

CREATE OR REPLACE FUNCTION core_lines_only_on_draft()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row record; v_status text; v_table text;
BEGIN
  -- On DELETE the row being removed is OLD; otherwise NEW. Both carry the parent.
  v_row := COALESCE(NEW, OLD);

  v_table := CASE v_row.document_type
    WHEN 'estimate' THEN 'estimates'
    WHEN 'quote'    THEN 'quotes'
    WHEN 'invoice'  THEN 'invoices'
    WHEN 'proposal' THEN 'proposals'
    ELSE NULL END;
  -- An unknown document_type is not this trigger's business to judge; the foreign shape will fail
  -- elsewhere. Letting it through is safer than blocking a family that arrives later.
  IF v_table IS NULL THEN RETURN v_row; END IF;

  EXECUTE format('SELECT status FROM %I WHERE id = $1 AND tenant_id = $2', v_table)
    INTO v_status USING v_row.document_id, v_row.tenant_id;

  -- No parent: let the foreign key say so, in its own words.
  IF v_status IS NULL THEN RETURN v_row; END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'document_not_draft'
      USING HINT = 'This document has been issued. Its lines and total are fixed — raise a credit note or a new document instead.';
  END IF;

  RETURN v_row;
END $$;

DROP TRIGGER IF EXISTS trg_lines_only_on_draft ON sales_document_lines;
CREATE TRIGGER trg_lines_only_on_draft
  BEFORE INSERT OR UPDATE OR DELETE ON sales_document_lines
  FOR EACH ROW EXECUTE FUNCTION core_lines_only_on_draft();

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect: the trigger, on INSERT/UPDATE/DELETE.

SELECT tgname, pg_get_triggerdef(oid) AS def
FROM pg_trigger WHERE tgname = 'trg_lines_only_on_draft';

-- Expect: every invoice still 'draft', so nothing existing is frozen by running this.
SELECT status, count(*) FROM invoices GROUP BY status;
