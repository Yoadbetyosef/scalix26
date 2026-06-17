-- Migration: enforce one CONNECTED agent per Meta page (Facebook/Instagram).
-- A partial unique index on meta_page_id, scoped to status='connected', so a page
-- can have history (disconnected rows) but only ever ONE connected row.
--
-- IMPORTANT: run this ONLY after the app code (connect-time block/move + 23505 guard)
-- is deployed, so a collision surfaces as a friendly message, never a raw SQL error.
-- Precondition (must return zero rows before creating the index):
--   SELECT meta_page_id, count(*) FROM channels
--   WHERE status='connected' AND meta_page_id IS NOT NULL
--   GROUP BY meta_page_id HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_meta_page_connected
  ON channels (meta_page_id)
  WHERE status = 'connected' AND meta_page_id IS NOT NULL;
