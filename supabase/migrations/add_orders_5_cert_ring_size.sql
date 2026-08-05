-- ============================================================================
-- Orders module — Phase 5: certificate lab and ring size on a line item.
--
-- Two attributes the jewelry form was missing. Both are dropdowns for the same reason the rest are:
-- a grading lab typed by hand comes back as "gia", "G.I.A." and "Gia" across three orders, and a ring
-- size typed by hand comes back as "6 1/2", "6.5" and "six and a half" — neither is searchable, and a
-- size is the one field on the form that a typo turns into a remake.
--
-- Same design as Phase 4: the line item stores the option's LABEL, not a foreign key, so retiring an
-- option never rewrites an order that was placed years ago.
--
-- Additive, idempotent. Safe to run more than once.
-- ============================================================================

-- ── The two new attributes ──────────────────────────────────────────────────────────────────────────

ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS certificate_lab text;   -- GIA | HRD | IGI | EGL
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS ring_size       text;   -- 3 … 12 in quarter sizes

-- ── Seed the two lists for tenants already carrying the jewelry dropdowns ───────────────────────────
-- Keyed off metal_karat rather than the orders module: a locksmith who enabled Orders must not acquire
-- ring sizes. Idempotent — a list is only created if absent, and options are only inserted for a list
-- created fresh, so re-running never resurrects an option the tenant deliberately deleted.

DO $$
DECLARE
  t        record;
  new_list uuid;
BEGIN
  FOR t IN
    SELECT DISTINCT tenant_id AS id FROM order_option_lists WHERE key = 'metal_karat'
  LOOP
    -- Certificate lab
    INSERT INTO order_option_lists (tenant_id, key, label, display_order)
    VALUES (t.id, 'certificate_lab', 'Certificate lab', 8)
    ON CONFLICT (tenant_id, key) DO NOTHING
    RETURNING id INTO new_list;

    IF new_list IS NOT NULL THEN
      INSERT INTO order_options (tenant_id, list_id, label, display_order)
      SELECT t.id, new_list, value, (ordinality - 1)::int
      FROM unnest(ARRAY['GIA', 'HRD', 'IGI', 'EGL']) WITH ORDINALITY AS s(value, ordinality);
    END IF;
    new_list := NULL;

    -- Ring size — 3 to 12 in quarter sizes. Whole sizes print bare ("4"), quarters keep two decimals
    -- ("4.25", "4.50") so the list reads as one column rather than a ragged mix.
    INSERT INTO order_option_lists (tenant_id, key, label, display_order)
    VALUES (t.id, 'ring_size', 'Ring size', 9)
    ON CONFLICT (tenant_id, key) DO NOTHING
    RETURNING id INTO new_list;

    IF new_list IS NOT NULL THEN
      INSERT INTO order_options (tenant_id, list_id, label, display_order)
      SELECT
        t.id, new_list,
        CASE WHEN v = trunc(v) THEN trunc(v)::int::text ELSE to_char(v, 'FM990.00') END,
        (ordinality - 1)::int
      FROM generate_series(3.00, 12.00, 0.25) WITH ORDINALITY AS s(v, ordinality);
    END IF;
    new_list := NULL;
  END LOOP;
END $$;

-- ── Rollback ────────────────────────────────────────────────────────────────────────────────────────
-- DELETE FROM order_option_lists WHERE key IN ('certificate_lab', 'ring_size');   -- options cascade
-- ALTER TABLE order_line_items DROP COLUMN IF EXISTS certificate_lab, DROP COLUMN IF EXISTS ring_size;
