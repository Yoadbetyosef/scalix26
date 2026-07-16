-- ============================================================================
-- Commerce module — Phase 1b: Inventory (locations, levels, immutable movement ledger)
-- ============================================================================
-- Depends on add_commerce_1_catalog.sql. Reservations + the reserve_inventory RPC are Phase 2.
-- Run in the Supabase SQL Editor. Idempotent.

-- ── Inventory locations ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commerce_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'warehouse'
                CHECK (type IN ('warehouse','showroom','floor_display','reserved','damaged','in_transit')),
  is_default  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_locations_tenant_idx ON commerce_locations (tenant_id);

-- ── Inventory levels (per stock item = product OR variant, per location) ────────────────────
-- `available` is DERIVED (on_hand - reserved), never manually edited (§8).
CREATE TABLE IF NOT EXISTS commerce_inventory_levels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_kind     text NOT NULL CHECK (item_kind IN ('product','variant')),
  item_id       uuid NOT NULL,
  location_id   uuid NOT NULL REFERENCES commerce_locations(id) ON DELETE CASCADE,
  on_hand       integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved      integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  available     integer GENERATED ALWAYS AS (on_hand - reserved) STORED,
  incoming      integer NOT NULL DEFAULT 0 CHECK (incoming >= 0),
  damaged       integer NOT NULL DEFAULT 0 CHECK (damaged >= 0),
  allocated     integer NOT NULL DEFAULT 0 CHECK (allocated >= 0),
  floor_display integer NOT NULL DEFAULT 0 CHECK (floor_display >= 0),
  expected_arrival_date date,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_inventory_levels_uniq
  ON commerce_inventory_levels (tenant_id, item_kind, item_id, location_id);
CREATE INDEX IF NOT EXISTS commerce_inventory_levels_item_idx
  ON commerce_inventory_levels (tenant_id, item_kind, item_id);

-- ── Immutable inventory movement ledger ─────────────────────────────────────────────────────
-- No direct quantity mutation without a movement row (§8). Immutable: a trigger blocks UPDATE/DELETE
-- (corrections are new reversing entries), even for the service role.
CREATE TABLE IF NOT EXISTS commerce_inventory_movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_kind      text NOT NULL CHECK (item_kind IN ('product','variant')),
  item_id        uuid NOT NULL,
  location_id    uuid NOT NULL REFERENCES commerce_locations(id) ON DELETE CASCADE,
  movement_type  text NOT NULL CHECK (movement_type IN (
                   'opening_balance','purchase_receipt','sale_commitment','reservation','reservation_release',
                   'allocation','delivery','customer_return','supplier_return','damage','transfer_out',
                   'transfer_in','manual_adjustment','cancellation_release')),
  quantity       integer NOT NULL,             -- signed delta applied to the level bucket
  reason         text,
  note           text,
  reference_type text,                          -- draft | customer_order | purchase_order | goods_receipt | …
  reference_id   uuid,
  before_qty     integer,                       -- snapshot for audit (§8, §19)
  after_qty      integer,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_inventory_movements_item_idx
  ON commerce_inventory_movements (tenant_id, item_kind, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commerce_inventory_movements_ref_idx
  ON commerce_inventory_movements (tenant_id, reference_type, reference_id);

-- Ledger rows are never rewritten (corrections are new reversing entries). Block UPDATE even for the
-- service role. DELETE is intentionally allowed so tenant-deletion CASCADE still works; the app never
-- issues a movement DELETE.
CREATE OR REPLACE FUNCTION commerce_movements_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'commerce_inventory_movements is an append-only ledger — UPDATE is not allowed (write a reversing entry instead)';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS commerce_movements_no_mutate ON commerce_inventory_movements;
CREATE TRIGGER commerce_movements_no_mutate
  BEFORE UPDATE ON commerce_inventory_movements
  FOR EACH ROW EXECUTE FUNCTION commerce_movements_immutable();

-- ── RLS ─────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['commerce_locations','commerce_inventory_levels','commerce_inventory_movements'])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id())', t||'_tenant', t);
  END LOOP;
END $$;
