-- ============================================================================
-- A photo per order line.
--
-- ── WHY PER LINE ────────────────────────────────────────────────────────────────────────────────────
--
-- Attachments today are per ORDER. Two pieces on one order — a ring and a pendant — share one pool
-- with no way to say which photo belongs to which piece, so a customer document can show both images
-- but cannot put either beside the item it depicts, and a workshop cannot tell them apart. Exactly the
-- flaw internal_cost_cents fixed for money.
--
-- ── WHY A REFERENCE, NOT A URL ──────────────────────────────────────────────────────────────────────
--
-- The studio module stores `image text` — a plain URL — because a studio product photo is public. An
-- ORDER photo is not: order_attachments live in a PRIVATE bucket, are reached through short-lived
-- signed URLs, and carry a visibility flag that decides whether a customer may ever see them.
--
-- Storing a URL on the line would bypass all three. A pasted URL has no visibility, no expiry and no
-- tenancy, so an internal CAD render could be published to a customer document by a copy and paste,
-- and nothing in the schema would object.
--
-- Referencing the attachment instead reuses the upload path, the private bucket, the signing and the
-- visibility rule, and keeps ONE answer to "may the customer see this file" rather than two that can
-- disagree. If you would rather match studio's shape literally, say so before this runs — it is a
-- one-line change and the reasoning above is the whole argument against it.
--
-- ── ON DELETE SET NULL ──────────────────────────────────────────────────────────────────────────────
--
-- Deleting an attachment must not delete the line it was attached to. The line is the commercial
-- record — what was ordered and what it cost — and losing it because somebody tidied up a file would
-- destroy the order. The line survives with no image, which is recoverable; the alternative is not.
--
-- ── VISIBILITY IS STILL THE ATTACHMENT'S ────────────────────────────────────────────────────────────
--
-- Pointing a line at an attachment does NOT publish it. The customer document renders images with
-- visibility = 'public' and no others, exactly as before; this only says which line an image belongs
-- to. Assigning an internal photo to a line keeps it internal.
--
-- Additive, idempotent, no backfill. Run AFTER add_order_internal_cost.sql.
-- ============================================================================

ALTER TABLE order_line_items
  ADD COLUMN IF NOT EXISTS image_attachment_id uuid
    REFERENCES order_attachments(id) ON DELETE SET NULL;

COMMENT ON COLUMN order_line_items.image_attachment_id IS
  'The order_attachments row depicting this line. Visibility still belongs to the attachment — pointing a line at an internal file does not publish it.';

-- Lines are read per order and are few, so this index is for the REVERSE lookup: "which lines use this
-- attachment", which is what a delete has to answer before it can set them null.
CREATE INDEX IF NOT EXISTS order_line_items_image_idx
  ON order_line_items (image_attachment_id)
  WHERE image_attachment_id IS NOT NULL;

-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS order_line_items_image_idx;
--   ALTER TABLE order_line_items DROP COLUMN image_attachment_id;
--
-- Safe: it drops the ASSIGNMENT, not the files. Every attachment stays in the bucket and in
-- order_attachments, so nothing a tenant uploaded is lost.
