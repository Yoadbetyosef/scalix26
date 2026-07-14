-- ============================================================================
-- Orders module — Phase 2: private order attachments. Files live in the PRIVATE `order-attachments` storage
-- bucket (created out-of-band, public=false); this table is the metadata + visibility control. Access is
-- always through short-lived signed URLs generated server-side — the bucket is never public. RLS tenant-scoped.
-- Run AFTER add_orders_1.sql.
-- ============================================================================
CREATE TABLE IF NOT EXISTS order_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,                                 -- `${tenant_id}/${order_id}/${uuid}.${ext}`
  file_name     text NOT NULL,
  mime_type     text NOT NULL,
  file_size     bigint NOT NULL DEFAULT 0,
  uploaded_by   text,
  visibility    text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','public')), -- only 'public' can be shown on an approval page
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_attachments_order_idx ON order_attachments (order_id);

ALTER TABLE order_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant order_attachments access" ON order_attachments;
CREATE POLICY "Tenant order_attachments access" ON order_attachments FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS order_attachments CASCADE;
