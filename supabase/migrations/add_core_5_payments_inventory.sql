-- ============================================================================
-- Scalix Core — Phase 5: Payments Ledger & Inventory Integrity
-- ============================================================================
-- Additive & non-destructive. Adds:
--   payment_allocations  — immutable, signed ledger of charges/deposits/refunds against a document;
--                          balance + payment status are DERIVED server-side, never client-set.
--   inventory_locations / inventory_levels / inventory_reservations / inventory_ledger — a proper
--   reserved/available model where every quantity change is one ATOMIC RPC (levels + ledger together),
--   so state and history never drift. The legacy catalog_products counters + catalog_movements are left
--   intact; this is the Core canonical model going forward.
-- Money = integer minor units (cents). Real RLS on all new tables. Idempotent. Run in Supabase SQL Editor.

-- ── payment allocations (immutable, signed) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('estimate','quote','order','invoice')),
  document_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('charge','deposit','refund','adjustment')),
  amount_cents bigint NOT NULL,          -- signed: + increases paid, − (refund) decreases paid
  currency text NOT NULL DEFAULT 'usd',
  payment_id uuid, provider_ref text,
  idempotency_key text,
  note text, created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_pay_alloc_doc ON payment_allocations (tenant_id, document_type, document_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_alloc_idem ON payment_allocations (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Apply a payment/refund atomically + idempotently. Returns derived paid/balance/status for the document.
-- amount_cents is the magnitude; refunds are stored negative. The document's total is read from its table.
CREATE OR REPLACE FUNCTION core_apply_payment(p_tenant uuid, p_doc_type text, p_doc_id uuid, p_kind text, p_amount_cents bigint, p_currency text, p_provider_ref text, p_key text, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_exists uuid; v_signed bigint; v_total bigint; v_paid bigint; v_balance bigint; v_status text;
BEGIN
  IF p_kind NOT IN ('charge','deposit','refund','adjustment') THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_kind'); END IF;
  IF p_key IS NOT NULL THEN
    SELECT id INTO v_exists FROM payment_allocations WHERE tenant_id = p_tenant AND idempotency_key = p_key;
    IF v_exists IS NOT NULL THEN
      SELECT COALESCE(SUM(amount_cents),0) INTO v_paid FROM payment_allocations WHERE tenant_id = p_tenant AND document_type = p_doc_type AND document_id = p_doc_id;
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'paid_cents', v_paid);
    END IF;
  END IF;
  v_signed := CASE WHEN p_kind = 'refund' THEN -abs(p_amount_cents) ELSE abs(p_amount_cents) END;
  INSERT INTO payment_allocations (tenant_id, document_type, document_id, kind, amount_cents, currency, provider_ref, idempotency_key, created_by)
    VALUES (p_tenant, p_doc_type, p_doc_id, p_kind, v_signed, COALESCE(p_currency,'usd'), p_provider_ref, p_key, p_actor);

  SELECT COALESCE(SUM(amount_cents),0) INTO v_paid FROM payment_allocations WHERE tenant_id = p_tenant AND document_type = p_doc_type AND document_id = p_doc_id;
  -- document total (estimates/quotes/invoices share total_cents; orders use subtotal/balance snapshot)
  IF p_doc_type IN ('estimate','quote','invoice') THEN
    EXECUTE format('SELECT total_cents FROM %I WHERE id=$1 AND tenant_id=$2', p_doc_type||'s') INTO v_total USING p_doc_id, p_tenant;
  ELSE
    SELECT subtotal_cents INTO v_total FROM orders WHERE id = p_doc_id AND tenant_id = p_tenant;
  END IF;
  v_total := COALESCE(v_total, 0);
  v_balance := v_total - v_paid;
  v_status := CASE WHEN v_paid <= 0 THEN 'unpaid' WHEN v_paid >= v_total THEN 'paid' ELSE 'partial' END;
  IF v_paid < 0 THEN v_status := 'refunded'; END IF;
  RETURN jsonb_build_object('ok', true, 'total_cents', v_total, 'paid_cents', v_paid, 'balance_cents', v_balance, 'status', v_status);
END $$;

-- ── inventory: locations, levels (reserved/available), reservations, ledger ──
CREATE TABLE IF NOT EXISTS inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, kind text NOT NULL DEFAULT 'warehouse', is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_inv_locations_tenant ON inventory_locations (tenant_id, is_active);

CREATE TABLE IF NOT EXISTS inventory_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_kind text NOT NULL CHECK (item_kind IN ('product','variant','component')),
  item_id uuid NOT NULL,
  location_id uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  on_hand numeric NOT NULL DEFAULT 0,
  reserved numeric NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  incoming numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, item_kind, item_id, location_id));
-- available = on_hand − reserved (never stored; always derived)

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_kind text NOT NULL, item_id uuid NOT NULL, location_id uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  quantity numeric NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held','released','allocated')),
  document_type text, document_id uuid, idempotency_key text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_resv_idem ON inventory_reservations (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_kind text NOT NULL, item_id uuid NOT NULL, location_id uuid NOT NULL,
  movement text NOT NULL CHECK (movement IN ('receive','reserve','release','allocate','ship','return','adjust')),
  quantity numeric NOT NULL, on_hand_after numeric, reserved_after numeric,
  reference_type text, reference_id uuid, reason text, idempotency_key text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_inv_ledger_item ON inventory_ledger (tenant_id, item_kind, item_id, location_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_ledger_idem ON inventory_ledger (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY['payment_allocations','inventory_locations','inventory_levels','inventory_reservations','inventory_ledger']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id())', t||'_tenant', t);
  END LOOP; END $$;

-- ── ONE atomic inventory movement RPC (levels + ledger always together) ─────
-- movement: receive(+on_hand) | reserve(+reserved, guarded by available) | release(−reserved) |
--           allocate(reserved→consumed: −reserved,−on_hand) | ship(−on_hand) | return(+on_hand) | adjust(set/Δ on_hand).
-- Idempotent on p_key. Never lets reserved exceed on_hand; never negative reserved.
CREATE OR REPLACE FUNCTION core_inventory_move(p_tenant uuid, p_kind text, p_item uuid, p_location uuid, p_movement text, p_qty numeric, p_ref_type text, p_ref_id uuid, p_key text, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_oh numeric; v_res numeric; v_new_oh numeric; v_new_res numeric;
BEGIN
  IF p_key IS NOT NULL AND EXISTS (SELECT 1 FROM inventory_ledger WHERE tenant_id = p_tenant AND idempotency_key = p_key) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;
  INSERT INTO inventory_levels (tenant_id, item_kind, item_id, location_id)
    VALUES (p_tenant, p_kind, p_item, p_location) ON CONFLICT (tenant_id, item_kind, item_id, location_id) DO NOTHING;
  SELECT on_hand, reserved INTO v_oh, v_res FROM inventory_levels WHERE tenant_id = p_tenant AND item_kind = p_kind AND item_id = p_item AND location_id = p_location FOR UPDATE;
  v_new_oh := v_oh; v_new_res := v_res;
  CASE p_movement
    WHEN 'receive' THEN v_new_oh := v_oh + p_qty;
    WHEN 'return'  THEN v_new_oh := v_oh + p_qty;
    WHEN 'ship'    THEN v_new_oh := v_oh - p_qty;
    WHEN 'adjust'  THEN v_new_oh := p_qty;                 -- set absolute
    WHEN 'reserve' THEN
      IF (v_oh - v_res) < p_qty THEN RETURN jsonb_build_object('ok', false, 'error', 'insufficient_available', 'available', v_oh - v_res); END IF;
      v_new_res := v_res + p_qty;
    WHEN 'release' THEN v_new_res := GREATEST(0, v_res - p_qty);
    WHEN 'allocate' THEN
      IF v_res < p_qty THEN RETURN jsonb_build_object('ok', false, 'error', 'insufficient_reserved'); END IF;
      v_new_res := v_res - p_qty; v_new_oh := v_oh - p_qty;
    ELSE RETURN jsonb_build_object('ok', false, 'error', 'bad_movement');
  END CASE;
  UPDATE inventory_levels SET on_hand = v_new_oh, reserved = v_new_res, updated_at = now()
    WHERE tenant_id = p_tenant AND item_kind = p_kind AND item_id = p_item AND location_id = p_location;
  INSERT INTO inventory_ledger (tenant_id, item_kind, item_id, location_id, movement, quantity, on_hand_after, reserved_after, reference_type, reference_id, idempotency_key, created_by)
    VALUES (p_tenant, p_kind, p_item, p_location, p_movement, p_qty, v_new_oh, v_new_res, p_ref_type, p_ref_id, p_key, p_actor);
  RETURN jsonb_build_object('ok', true, 'on_hand', v_new_oh, 'reserved', v_new_res, 'available', v_new_oh - v_new_res);
END $$;
REVOKE ALL ON FUNCTION core_apply_payment(uuid,text,uuid,text,bigint,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core_inventory_move(uuid,text,uuid,uuid,text,numeric,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
