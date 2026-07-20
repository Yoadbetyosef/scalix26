-- ============================================================================
-- Consistency fix for proposal numbering. add_core_13 seeds a 'PROP-' counter for tenants that existed at
-- migration time, but a tenant provisioned AFTER that (or one whose counter was auto-created first) gets the
-- raw function default 'PRO-' (upper(left('proposal',3))). This makes 'proposal' default to 'PROP-' so ALL
-- tenants are consistent, and normalizes any UNUSED (next_number=1) 'PRO-' proposal counter. Additive +
-- idempotent. Cosmetic only — numbering was already unique + sequential; this just aligns the prefix.
-- ============================================================================

CREATE OR REPLACE FUNCTION core_next_document_number(p_tenant uuid, p_doc_type text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prefix text; v_pad int; v_num bigint; v_default_prefix text;
BEGIN
  -- proposal → 'PROP-' (friendlier than the raw 3-letter default); everything else keeps the 3-letter default.
  v_default_prefix := CASE WHEN p_doc_type = 'proposal' THEN 'PROP-' ELSE upper(left(p_doc_type, 3)) || '-' END;
  INSERT INTO numbering_counters (tenant_id, doc_type, prefix, next_number)
    VALUES (p_tenant, p_doc_type, v_default_prefix, 1)
    ON CONFLICT (tenant_id, doc_type) DO NOTHING;
  UPDATE numbering_counters SET next_number = next_number + 1
    WHERE tenant_id = p_tenant AND doc_type = p_doc_type
    RETURNING prefix, padding, next_number - 1 INTO v_prefix, v_pad, v_num;
  RETURN v_prefix || lpad(v_num::text, v_pad, '0');
END $$;

-- Align existing UNUSED proposal counters (no numbers issued yet) to the 'PROP-' standard. Only next_number=1
-- rows are touched, so a counter that already issued PRO-000x numbers is left alone (no renumbering).
UPDATE numbering_counters SET prefix = 'PROP-'
  WHERE doc_type = 'proposal' AND prefix = 'PRO-' AND next_number = 1;

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- Restore core_next_document_number from add_core_4_sales_lifecycle.sql (v_default_prefix without the CASE).
