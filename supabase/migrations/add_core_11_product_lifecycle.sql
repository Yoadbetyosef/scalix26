-- ============================================================================
-- Scalix Core — Product lifecycle: archive + safe soft-delete (tombstone)
-- ============================================================================
-- Additive & non-destructive. Adds archive/delete lifecycle to catalog_products so a whole product can be
-- archived (reversible, hidden from the active catalog + new selection, kept in history) or deleted. Delete
-- is SAFE: when the product (or any of its components) is referenced by historical document lines, it is
-- soft-deleted (tombstoned via deleted_at) so estimates/quotes/orders/invoices/payments/activity keep their
-- references and stay readable; only truly-unreferenced products are hard-deleted (CASCADE) in app code.
-- Tenant-scoped. Run in a FRESH SQL Editor tab.

ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_catalog_products_lifecycle ON catalog_products (tenant_id, archived_at, deleted_at);
