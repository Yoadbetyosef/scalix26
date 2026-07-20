-- ============================================================================
-- Component & variant inventory: availability status, incoming shipments (with expected arrival + supplier/
-- PO refs), and AI/internal/location notes — for ANY inventory item (product | variant | component).
-- Additive + idempotent. REUSES the existing polymorphic ledger (inventory_levels/reservations/ledger keyed
-- by (item_kind, item_id)) and the core_inventory_move RPC — NO duplicate inventory tables. Two small
-- additive tables carry the concepts the ledger doesn't model yet: per-item meta and scheduled shipments.
-- ============================================================================

-- Per-item availability + notes. availability_status = NULL means "auto-derive from on_hand/reserved/incoming".
CREATE TABLE IF NOT EXISTS inventory_item_meta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_kind text NOT NULL CHECK (item_kind IN ('product','variant','component')),
  item_id uuid NOT NULL,
  availability_status text CHECK (availability_status IN ('in_stock','low_stock','out_of_stock','incoming','made_to_order','discontinued')),
  low_stock_threshold numeric NOT NULL DEFAULT 0,
  ai_notes text,          -- customer-facing; the AI may repeat these verbatim
  internal_notes text,    -- never shown to customers / the AI
  location_notes text,    -- free notes about where stock physically sits
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, item_kind, item_id));
CREATE INDEX IF NOT EXISTS idx_inv_meta_item ON inventory_item_meta (tenant_id, item_kind, item_id);

-- Scheduled incoming shipments (many per item). Aggregate "incoming" = Σ quantity WHERE status='expected'.
-- Marking one 'received' triggers a ledger `receive` in the app (idempotent via received_movement_key).
CREATE TABLE IF NOT EXISTS inventory_incoming (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_kind text NOT NULL CHECK (item_kind IN ('product','variant','component')),
  item_id uuid NOT NULL,
  location_id uuid REFERENCES inventory_locations(id) ON DELETE SET NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  expected_arrival_date date,
  supplier_ref text, po_ref text, notes text,
  status text NOT NULL DEFAULT 'expected' CHECK (status IN ('expected','received','cancelled')),
  received_movement_key text,   -- idempotency link to the ledger receive movement
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_inv_incoming_item ON inventory_incoming (tenant_id, item_kind, item_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_incoming_arrival ON inventory_incoming (tenant_id, status, expected_arrival_date);

ALTER TABLE inventory_item_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_incoming  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant inventory_item_meta access" ON inventory_item_meta;
CREATE POLICY "Tenant inventory_item_meta access" ON inventory_item_meta FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());
DROP POLICY IF EXISTS "Tenant inventory_incoming access" ON inventory_incoming;
CREATE POLICY "Tenant inventory_incoming access" ON inventory_incoming FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS inventory_incoming, inventory_item_meta CASCADE;
