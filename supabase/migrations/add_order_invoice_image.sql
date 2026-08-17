-- ============================================================================
-- THE ONE PHOTO THAT GOES ON THE INVOICE.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- Today the customer's document prints EVERY public image on the order, in
-- upload order. Uploads default to public deliberately — a photo the factory
-- needs must not sit unseen behind a second action nobody takes — and that is
-- right for the factory hand-off and wrong for the customer's invoice, because
-- the same list feeds both.
--
-- On TG jewellers' live data that is 16 public images across 9 orders, five of
-- which would print more than one, and the filenames include a reference
-- diagram (anatomy-of-a-ring.png), a competitor's catalogue photo and phone
-- snaps. All of it currently customer-facing.
--
-- ── ONE PER ORDER, NOT PER LINE ────────────────────────────────────────────
--
-- Her words were "one final photo of the ring". order_line_items already has an
-- `image_attachment_id` column, added by an earlier migration and wired to
-- NOTHING — no read, no write, no type field, and set on 0 of her 12 lines. It
-- is left exactly as it is. Half-wiring it now would leave two columns that both
-- look like the answer, and the next person would have to work out which one is
-- real. Recorded in lib/invoices/OUTSTANDING.md as the shape for per-line photos
-- if she asks for them.
--
-- ── ON DELETE SET NULL, NOT CASCADE ────────────────────────────────────────
--
-- Deleting the attachment must not delete the order. It un-chooses the photo,
-- which is the correct outcome and also the visible one: the invoice goes back
-- to printing no image, which is what "nothing chosen" already means.
--
-- ── NOTHING IS BACKFILLED ──────────────────────────────────────────────────
--
-- No order gets a photo chosen for it. Nothing chosen means the invoice prints
-- NO image — better than the wrong one, and the only honest default when the
-- distinction between a render and a final photo exists nowhere in the data.
-- Her nine orders with public images keep every one of them on the ESTIMATE,
-- where reference material belongs; the invoice for those orders prints none
-- until she picks.
-- ============================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS invoice_image_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_invoice_image_fk'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_invoice_image_fk
      FOREIGN KEY (invoice_image_id) REFERENCES order_attachments (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orders_invoice_image_idx
  ON orders (invoice_image_id) WHERE invoice_image_id IS NOT NULL;

COMMENT ON COLUMN orders.invoice_image_id IS
  'The ONE attachment printed on the invoice document. Null = no image on the invoice, which is the default and is better than the wrong one. The ESTIMATE still prints the whole public gallery — reference material belongs there. Not the same idea as order_line_items.image_attachment_id, which is unwired.';

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect the column, the FK with ON DELETE SET NULL, and the partial index.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'invoice_image_id';

SELECT conname, confdeltype  -- expect 'n' = SET NULL
FROM pg_constraint WHERE conname = 'orders_invoice_image_fk';

SELECT indexname FROM pg_indexes WHERE indexname = 'orders_invoice_image_idx';

-- Expect 0 on every tenant: nothing is backfilled, so no invoice prints an
-- image until somebody chooses one.
SELECT count(*) AS orders_with_a_chosen_photo FROM orders WHERE invoice_image_id IS NOT NULL;

-- What she has to choose FROM. Expect 9 orders holding 16 public images, five of
-- them with more than one — the documents that print a gallery today.
SELECT o.order_number,
       count(*) FILTER (WHERE a.visibility = 'public' AND a.mime_type LIKE 'image/%') AS public_images
FROM orders o
JOIN order_attachments a ON a.order_id = o.id
WHERE o.tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
GROUP BY o.order_number
HAVING count(*) FILTER (WHERE a.visibility = 'public' AND a.mime_type LIKE 'image/%') > 0
ORDER BY 2 DESC;

-- Expect 0: order_line_items.image_attachment_id is untouched by all of this and
-- stays unwired. See OUTSTANDING.
SELECT count(*) AS line_photos_set FROM order_line_items WHERE image_attachment_id IS NOT NULL;
