-- ============================================================================
-- WHAT THE PIECE IS -- product_type on an order line.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- VERSION 2. Version 1 was run against the right project and NOTHING applied --
-- no column, no lists, her Riviera list untouched -- and no error was surfaced
-- in the editor. Whole-script rollback is what that looks like: one statement
-- raised, the editor ran the file in a single transaction, and everything went
-- back including the ALTER.
--
-- What changed to make this diagnosable, following add_at_business_meeting_kind:
--   * FIVE NUMBERED PARTS. Run them one at a time. Whichever one errors is the
--     answer, and the parts before it stay applied because each is independent
--     and each is re-runnable.
--   * NO DATA-MODIFYING CTE. Version 1 created the list and its options in one
--     statement, WITH new_list AS (INSERT ... RETURNING id) INSERT ... That is
--     legal Postgres and it is the only unusual construct in the file, so it is
--     the first thing to remove rather than the last. Parts 2 and 3 are two
--     plain INSERTs that find each other by key.
--   * No apostrophes in comment prose, and no semicolons inside any string
--     literal. Harmless to Postgres, not harmless to every paste path, and the
--     inch marks in version 1 put four apostrophes in one comment line.
--   * Verification is PART 5, separate, so a SELECT can never roll back DDL.
--
-- ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
--
-- The order form was built for a ring. Every line rendered Centre shape, Centre
-- weight and Ring size whatever the thing was, and the one thing it could not
-- record was what the thing actually was. Her eighteen line items said so:
--
--   * On both tennis necklaces the length went into Measurements and the TOTAL
--     weight, 17ct and 11ct, went into CENTRE weight -- a box for one stone,
--     whose words then print at a customer.
--   * measurements is holding three quantities across her rows: stone
--     dimensions, band width in mm, and length in inches.
--   * Six of eighteen lines carry a ring size. Three are plainly not rings.
--   * She had already built the missing field herself, an option list of
--     lengths, and named it after a product because the form renders only the
--     nine keys it knows and there was nowhere else to put it.
--
-- ONE COLUMN, and only one. Everything else is achieved by NAMING the columns
-- that already exist per type -- see lib/orders/product-types.ts. That is the
-- only design under which her 17ct does not have to move.
--
-- NOTHING IS BACKFILLED. product_type stays null on all eighteen rows. The
-- application reads the product NAME when it is empty, so a tennis necklace
-- lays out and prints correctly with no row rewritten and nothing claiming she
-- said something she did not.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- PART 1 of 5 -- the column. Run this alone first.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS product_type text;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 2 of 5 -- the type list, which is HERS.
--
-- An ordinary option list, exactly like the stone list: she adds, renames,
-- reorders and retires from Settings with no deploy. display_order 0 puts it
-- above the stone lists, because it is the answer that decides the rest.
--
-- The NOT EXISTS guard is what makes this re-runnable. The unique index on
-- (tenant_id, key) would refuse a second one anyway; the guard means a re-run
-- is a no-op rather than an error.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO order_option_lists (tenant_id, key, label, display_order)
SELECT 'e6f07ad7-c5a2-4997-b798-cca7e09e837f', 'product_type', 'Piece type', 0
 WHERE EXISTS (
         SELECT 1 FROM tenants
          WHERE id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f')
   AND NOT EXISTS (
         SELECT 1 FROM order_option_lists
          WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
            AND key = 'product_type');


-- ════════════════════════════════════════════════════════════════════════════
-- PART 3 of 5 -- the eight types.
--
-- Finds the list Part 2 made BY KEY rather than by a returned id, which is what
-- lets these be two statements instead of one clever one. The per-option guard
-- means a re-run adds only what is missing, so a type she has since deleted
-- stays deleted -- the same rule the starter templates hold themselves to.
--
-- The eight are the ones her data proves she sells plus the obvious neighbours.
-- A type she invents later needs no code: it shows every field until somebody
-- describes what it needs, which is the form exactly as it is today.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO order_options (tenant_id, list_id, label, display_order)
SELECT l.tenant_id, l.id, v.label, v.ord
  FROM order_option_lists l
 CROSS JOIN (VALUES
         ('Ring', 0), ('Band', 1), ('Earrings', 2), ('Pendant', 3),
         ('Necklace', 4), ('Tennis necklace', 5), ('Bracelet', 6), ('Tennis bracelet', 7)
       ) AS v(label, ord)
 WHERE l.tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
   AND l.key = 'product_type'
   AND NOT EXISTS (
         SELECT 1 FROM order_options o
          WHERE o.list_id = l.id
            AND lower(o.label) = lower(v.label));


-- ════════════════════════════════════════════════════════════════════════════
-- PART 4 of 5 -- HER LENGTH LIST, PROMOTED.
--
-- THIS IS THE ONE STATEMENT THAT EDITS DATA SHE TYPED. Her list of lengths
-- keeps every value. What changes is the KEY, from a product name to length,
-- which is the only reason it never showed up on an order -- and the LABEL, so
-- the Settings screen calls it what it is. Renaming it is the difference
-- between the work she did being used and staying invisible. Recorded in
-- lib/orders/OUTSTANDING.md section 1, so the answer exists if she asks.
--
-- Guarded three ways: only her tenant, only if that list is still there, and
-- only if she has no length list already.
--
-- The second statement deactivates the first option in that list, a heading she
-- typed because the list name was taken by a product. Deactivated and NOT
-- deleted: it leaves new orders, any order carrying it keeps its text, and she
-- can revive it from Settings in one click.
-- ════════════════════════════════════════════════════════════════════════════

UPDATE order_option_lists
   SET key = 'length', label = 'Length'
 WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
   AND key = 'timeless_dreams_riviera_diamond_necklace'
   AND NOT EXISTS (
         SELECT 1 FROM order_option_lists
          WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
            AND key = 'length');

UPDATE order_options o
   SET active = false
  FROM order_option_lists l
 WHERE o.list_id = l.id
   AND l.tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
   AND l.key = 'length'
   AND lower(o.label) = 'necklace length';


-- ════════════════════════════════════════════════════════════════════════════
-- PART 5 of 5 -- verification. Read-only. Run it last and separately, so that
-- a SELECT can never be the reason DDL rolls back.
-- ════════════════════════════════════════════════════════════════════════════

-- Expect one row: the column exists.
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'order_line_items'
   AND column_name = 'product_type';

-- Expect 18 and 0. Nothing is backfilled; the application infers from the name.
SELECT count(*) AS line_count, count(product_type) AS typed_lines
  FROM order_line_items
 WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f';

-- Expect 11 lists. product_type with 8 options, length with 6 of which 5 are
-- active, and NO list still keyed on a product name.
SELECT l.display_order,
       l.key,
       l.label,
       count(o.id) AS total_options,
       count(o.id) FILTER (WHERE o.active) AS active_options
  FROM order_option_lists l
  LEFT JOIN order_options o ON o.list_id = l.id
 WHERE l.tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
 GROUP BY l.display_order, l.key, l.label
 ORDER BY l.display_order;

-- The two rows this was written for. Expect 17 and 11 still sitting in
-- center_stone_carat, untouched, with product_type null. They are correct the
-- moment the line reads as a tennis piece, because the FIELD is renamed rather
-- than the number moved.
SELECT product_name, center_stone_carat, measurements, product_type
  FROM order_line_items
 WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
   AND product_name ILIKE '%tennis%';


-- ── Reverse (down) ─────────────────────────────────────────────────────────
--   ALTER TABLE order_line_items DROP COLUMN IF EXISTS product_type;
--   DELETE FROM order_option_lists
--    WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
--      AND key = 'product_type';
--   UPDATE order_option_lists
--      SET key = 'timeless_dreams_riviera_diamond_necklace',
--          label = 'Timeless Dreams Riviera Diamond Necklace'
--    WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
--      AND key = 'length';
--   UPDATE order_options o SET active = true
--     FROM order_option_lists l
--    WHERE o.list_id = l.id
--      AND l.tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
--      AND lower(o.label) = 'necklace length';
--
-- Dropping product_type loses every type she has picked since. The list and its
-- options survive it; the choices on the line items do not.
