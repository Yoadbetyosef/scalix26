-- ============================================================================
-- WHAT THE PIECE IS
--
-- The order form was built for a ring, and every line rendered Centre shape, Centre weight and Ring
-- size whatever the thing was. Her own eighteen line items are the argument for changing it:
--
--   • On both tennis necklaces the length went into Measurements ("16''") and the TOTAL weight — 17ct
--     and 11ct — went into CENTRE weight, which is a box for one stone. Nothing was lost. It was filed
--     under the wrong words, and those words print on a customer's document.
--   • `measurements` is holding three different quantities across her rows: stone dimensions
--     ("10X7.5X4"), band width ("2.00mm") and length ("16''"). One column, three meanings, one label.
--   • Six of eighteen lines carry a ring size. Three are plainly not rings.
--   • She had already built the missing field herself — an option list of 16'' … 22'' — and named it
--     after a product, "Timeless Dreams Riviera Diamond Necklace", because there was nowhere else to
--     put it. The form only renders the nine keys it knows, so it never appeared on an order. That is
--     a gap in the form, not a mistake she made, and this migration is where it gets closed.
--
-- ── ONE COLUMN, AND ONLY ONE ────────────────────────────────────────────────────────────────────────
--
-- order_line_items.product_type. Everything else is achieved by NAMING the columns that already exist
-- per type — see the long note in lib/orders/product-types.ts. That is not a shortcut; it is the only
-- design under which her 17ct does not have to move. A new "total weight" column would mean migrating
-- the two rows this whole exercise is about, and leaving two columns that could each hold the truth.
--
-- NOTHING IS BACKFILLED. product_type is null on all eighteen existing lines and stays null. The
-- application reads the product NAME when the column is empty, so "Tennis necklace" lays out and
-- prints correctly from the moment this is applied, without a single row being rewritten and without
-- anything claiming she said something she did not.
--
-- Additive and idempotent, except for the one deliberate edit to her own data called out below.
-- ============================================================================

ALTER TABLE order_line_items
  ADD COLUMN IF NOT EXISTS product_type text;


-- ── The type list, which is HERS ────────────────────────────────────────────────────────────────────
--
-- An ordinary option list, exactly like the stone list: she adds, renames, reorders and retires from
-- Settings with no deploy. The eight below are the ones her data proves she sells plus the obvious
-- neighbours. A type she invents later shows every field until somebody describes what it needs, which
-- is the form as it is today — so a new type is never worse than the status quo.
--
-- display_order 0 puts it above the stone lists, because it is the answer that decides the rest.
WITH new_list AS (
  INSERT INTO order_option_lists (tenant_id, key, label, display_order)
  SELECT 'e6f07ad7-c5a2-4997-b798-cca7e09e837f', 'product_type', 'Piece type', 0
   WHERE EXISTS (SELECT 1 FROM tenants WHERE id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f')
     AND NOT EXISTS (SELECT 1 FROM order_option_lists
                      WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f' AND key = 'product_type')
  RETURNING id
)
INSERT INTO order_options (tenant_id, list_id, label, display_order)
SELECT 'e6f07ad7-c5a2-4997-b798-cca7e09e837f', new_list.id, v.label, v.ord
  FROM new_list,
       (VALUES ('Ring', 0), ('Band', 1), ('Earrings', 2), ('Pendant', 3),
               ('Necklace', 4), ('Tennis necklace', 5), ('Bracelet', 6), ('Tennis bracelet', 7)
       ) AS v(label, ord);


-- ── HER LENGTH LIST, PROMOTED ───────────────────────────────────────────────────────────────────────
--
-- THIS IS THE ONE STATEMENT THAT EDITS DATA SHE TYPED, and it is worth being plain about. Her list of
-- 16'' … 22'' keeps every value. What changes is the list's KEY, from a product name to `length`,
-- which is the only reason it never showed up on an order — and its LABEL, so the Settings screen
-- calls it what it is. Renaming it is the difference between the work she did being used and staying
-- invisible.
--
-- Guarded three ways: only her tenant, only if that list is still there, and only if she has no
-- `length` list already (the unique index on (tenant_id, key) would refuse a second one).
UPDATE order_option_lists
   SET key = 'length', label = 'Length'
 WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
   AND key = 'timeless_dreams_riviera_diamond_necklace'
   AND NOT EXISTS (SELECT 1 FROM order_option_lists
                    WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f' AND key = 'length');

-- "Necklace Length" was the first option in that list — a heading she typed because the list's name
-- was taken by a product. Deactivated rather than deleted: it disappears from new orders, and any
-- order that somehow carries it keeps its text. She can revive it from Settings in one click.
UPDATE order_options o
   SET active = false
  FROM order_option_lists l
 WHERE o.list_id = l.id
   AND l.tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
   AND l.key = 'length'
   AND lower(o.label) = 'necklace length';


-- ── Verify ──────────────────────────────────────────────────────────────────────────────────────────

-- Expect 18 rows and 18 nulls: nothing was backfilled, and the application infers from the name.
SELECT count(*) AS lines, count(product_type) AS lines_with_a_type
  FROM order_line_items WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f';

-- Expect 11 lists, with `product_type` (8 options) and `length` (6 options, one of them inactive)
-- among them, and NO list still keyed on a product name.
SELECT l.key, l.label, count(o.id) AS options, count(o.id) FILTER (WHERE o.active) AS active_options
  FROM order_option_lists l
  LEFT JOIN order_options o ON o.list_id = l.id
 WHERE l.tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
 GROUP BY l.key, l.label, l.display_order
 ORDER BY l.display_order;

-- The two rows this was written for. Expect 17.00 and 11.00 still sitting in center_stone_carat,
-- untouched — they are correct the moment the line reads as a tennis piece, because the FIELD is
-- renamed rather than the number moved.
SELECT product_name, center_stone_carat, measurements, product_type
  FROM order_line_items
 WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
   AND product_name ILIKE '%tennis%';


-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
--   ALTER TABLE order_line_items DROP COLUMN IF EXISTS product_type;
--   DELETE FROM order_option_lists
--    WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f' AND key = 'product_type';
--   UPDATE order_option_lists
--      SET key = 'timeless_dreams_riviera_diamond_necklace', label = 'Timeless Dreams Riviera Diamond Necklace'
--    WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f' AND key = 'length';
--   UPDATE order_options o SET active = true FROM order_option_lists l
--    WHERE o.list_id = l.id AND l.tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
--      AND lower(o.label) = 'necklace length';
--
-- Dropping product_type loses every type she has picked since. The list and its options survive it;
-- the choices on the line items do not.
