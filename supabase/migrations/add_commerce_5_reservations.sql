-- ============================================================================
-- Commerce module — Phase 2b: Reservations + safe reserve/release/expire RPCs
-- ============================================================================
-- The no-oversell primitive. Copies the proven apply_balance_txn recipe: SELECT ... FOR UPDATE the
-- level row (serialize concurrent reservers), guard `available >= qty` BEFORE mutating, gate on a UNIQUE
-- idempotency key so retries are no-ops. Reservations/levels/movements are written ONLY by these
-- SECURITY DEFINER functions (run as owner, bypassing the Phase-1c REVOKE); tenant clients get reads
-- via RLS but no direct writes. Run in the Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS commerce_reservations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_kind         text NOT NULL CHECK (item_kind IN ('product','variant')),
  item_id           uuid NOT NULL,
  location_id       uuid NOT NULL REFERENCES commerce_locations(id) ON DELETE CASCADE,
  quantity          integer NOT NULL CHECK (quantity > 0),
  draft_id          uuid REFERENCES commerce_drafts(id) ON DELETE SET NULL,
  customer_order_id uuid,
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','partially_fulfilled','fulfilled','released','expired','cancelled')),
  expires_at        timestamptz,
  idempotency_key   text NOT NULL,
  created_by        text,
  released_by       text,
  release_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_reservations_idem_uniq ON commerce_reservations (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS commerce_reservations_item_idx ON commerce_reservations (tenant_id, item_kind, item_id, status);
CREATE INDEX IF NOT EXISTS commerce_reservations_draft_idx ON commerce_reservations (tenant_id, draft_id);
CREATE INDEX IF NOT EXISTS commerce_reservations_expiry_idx ON commerce_reservations (status, expires_at) WHERE status = 'active';

ALTER TABLE commerce_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_reservations_tenant ON commerce_reservations;
CREATE POLICY commerce_reservations_tenant ON commerce_reservations FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());
-- Reads via RLS; writes ONLY through the RPCs / service role (mirrors the inventory lockdown).
REVOKE INSERT, UPDATE, DELETE ON commerce_reservations FROM anon, authenticated;

-- ── reserve_inventory: atomic, idempotent, never oversells ──────────────────────────────────────
CREATE OR REPLACE FUNCTION reserve_inventory(
  p_tenant uuid, p_item_kind text, p_item_id uuid, p_location_id uuid, p_qty integer,
  p_draft_id uuid, p_order_id uuid, p_expires_at timestamptz, p_idempotency_key text, p_created_by text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing_id uuid; lvl commerce_inventory_levels%ROWTYPE; v_available int; v_res_id uuid;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'quantity_must_be_positive'); END IF;

  -- Idempotency: same key → the existing reservation, applied once.
  SELECT id INTO existing_id FROM commerce_reservations WHERE tenant_id = p_tenant AND idempotency_key = p_idempotency_key;
  IF existing_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'reservation_id', existing_id, 'idempotent', true); END IF;

  -- Row-lock the level → concurrent reservers serialize here (no oversell of the last unit).
  SELECT * INTO lvl FROM commerce_inventory_levels
    WHERE tenant_id = p_tenant AND item_kind = p_item_kind AND item_id = p_item_id AND location_id = p_location_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_stock', 'requested', p_qty, 'available', 0, 'missing', p_qty, 'incoming', 0);
  END IF;

  v_available := lvl.on_hand - lvl.reserved;
  IF v_available < p_qty THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient',
      'requested', p_qty, 'available', v_available, 'missing', p_qty - v_available,
      'incoming', lvl.incoming, 'expected_arrival', lvl.expected_arrival_date);
  END IF;

  INSERT INTO commerce_reservations(tenant_id, item_kind, item_id, location_id, quantity, draft_id, customer_order_id, status, expires_at, idempotency_key, created_by)
    VALUES (p_tenant, p_item_kind, p_item_id, p_location_id, p_qty, p_draft_id, p_order_id, 'active', p_expires_at, p_idempotency_key, p_created_by)
    RETURNING id INTO v_res_id;
  UPDATE commerce_inventory_levels SET reserved = reserved + p_qty, updated_at = now() WHERE id = lvl.id;
  INSERT INTO commerce_inventory_movements(tenant_id, item_kind, item_id, location_id, movement_type, quantity, reference_type, reference_id, before_qty, after_qty, created_by)
    VALUES (p_tenant, p_item_kind, p_item_id, p_location_id, 'reservation', p_qty,
            CASE WHEN p_draft_id IS NOT NULL THEN 'draft' ELSE 'customer_order' END, COALESCE(p_draft_id, p_order_id), lvl.reserved, lvl.reserved + p_qty, p_created_by);
  RETURN jsonb_build_object('ok', true, 'reservation_id', v_res_id, 'available_after', lvl.on_hand - (lvl.reserved + p_qty));
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO v_res_id FROM commerce_reservations WHERE tenant_id = p_tenant AND idempotency_key = p_idempotency_key;
  RETURN jsonb_build_object('ok', true, 'reservation_id', v_res_id, 'idempotent', true);
END $$;

-- ── release_reservation: free a reservation, decrement reserved, ledger it ───────────────────────
CREATE OR REPLACE FUNCTION release_reservation(
  p_tenant uuid, p_reservation_id uuid, p_reason text, p_released_by text, p_new_status text DEFAULT 'released'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r commerce_reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM commerce_reservations WHERE tenant_id = p_tenant AND id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF r.status NOT IN ('active', 'partially_fulfilled') THEN RETURN jsonb_build_object('ok', true, 'noop', true); END IF;
  UPDATE commerce_reservations SET status = p_new_status, released_by = p_released_by, release_reason = p_reason, updated_at = now() WHERE id = r.id;
  UPDATE commerce_inventory_levels SET reserved = GREATEST(0, reserved - r.quantity), updated_at = now()
    WHERE tenant_id = p_tenant AND item_kind = r.item_kind AND item_id = r.item_id AND location_id = r.location_id;
  INSERT INTO commerce_inventory_movements(tenant_id, item_kind, item_id, location_id, movement_type, quantity, reference_type, reference_id, created_by, note)
    VALUES (p_tenant, r.item_kind, r.item_id, r.location_id, 'reservation_release', -r.quantity,
            CASE WHEN r.draft_id IS NOT NULL THEN 'draft' ELSE 'customer_order' END, COALESCE(r.draft_id, r.customer_order_id), p_released_by, p_reason);
  RETURN jsonb_build_object('ok', true, 'released', r.quantity);
END $$;

-- ── expire_commerce_reservations: cron entrypoint — auto-release past-due active reservations ─────
CREATE OR REPLACE FUNCTION expire_commerce_reservations() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r commerce_reservations%ROWTYPE; n int := 0;
BEGIN
  FOR r IN SELECT * FROM commerce_reservations WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now() FOR UPDATE
  LOOP
    PERFORM release_reservation(r.tenant_id, r.id, 'reservation expired', 'system', 'expired');
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Service-role only (the app calls via the admin client). Never callable by tenant clients directly.
REVOKE ALL ON FUNCTION reserve_inventory(uuid,text,uuid,uuid,integer,uuid,uuid,timestamptz,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_reservation(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION expire_commerce_reservations() FROM PUBLIC, anon, authenticated;
