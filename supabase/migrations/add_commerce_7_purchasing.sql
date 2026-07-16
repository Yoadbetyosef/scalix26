-- ============================================================================
-- Commerce module — Phase 4: Suppliers, Purchase Orders, Receiving
-- ============================================================================
-- Depends on migrations 1–6. Run in the Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS commerce_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_name text NOT NULL, factory_name text, primary_contact text, email text, phone text, address jsonb,
  payment_terms text, default_currency text NOT NULL DEFAULT 'usd', default_lead_time_days integer,
  shipping_instructions text, minimum_order_amount_cents bigint, minimum_order_quantity integer,
  notes text, is_active boolean NOT NULL DEFAULT true, quickbooks_vendor_id text,
  created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS commerce_suppliers_tenant_idx ON commerce_suppliers (tenant_id, is_active);

CREATE TABLE IF NOT EXISTS commerce_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  po_number text NOT NULL, supplier_id uuid REFERENCES commerce_suppliers(id) ON DELETE SET NULL, supplier_contact text, factory text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_approval','approved','sent_to_supplier','supplier_confirmed','in_production','ready_to_ship','in_transit','partially_received','received','cancelled','closed')),
  currency text NOT NULL DEFAULT 'usd', order_date date, expected_ship_date date, expected_arrival_date date,
  shipping_method text, shipping_address jsonb, payment_terms text,
  customer_order_id uuid REFERENCES commerce_customer_orders(id) ON DELETE SET NULL, draft_id uuid,
  internal_notes text, supplier_notes text,
  subtotal_cents bigint NOT NULL DEFAULT 0, shipping_cost_cents bigint NOT NULL DEFAULT 0, additional_cost_cents bigint NOT NULL DEFAULT 0, total_cost_cents bigint NOT NULL DEFAULT 0,
  -- approval (§10)
  approval_required text NOT NULL DEFAULT 'none' CHECK (approval_required IN ('none','manager','admin')),
  requested_by text, approved_by text, approved_at timestamptz, rejected_by text, rejection_reason text,
  -- factory email delivery (§11)
  email_status text NOT NULL DEFAULT 'not_sent' CHECK (email_status IN ('not_sent','sent','failed')),
  email_message_id text, email_recipient text, email_subject text, email_sent_at timestamptz, email_sent_by text, email_retry_count integer NOT NULL DEFAULT 0, email_content_snapshot text,
  quickbooks_po_id text,
  created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS commerce_po_number_uniq ON commerce_purchase_orders (tenant_id, po_number);
CREATE INDEX IF NOT EXISTS commerce_po_tenant_status_idx ON commerce_purchase_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS commerce_po_supplier_idx ON commerce_purchase_orders (tenant_id, supplier_id);

CREATE TABLE IF NOT EXISTS commerce_po_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  po_id uuid NOT NULL REFERENCES commerce_purchase_orders(id) ON DELETE CASCADE,
  product_id uuid, variant_id uuid, component_id uuid, sku_snapshot text, description_snapshot text, options_snapshot jsonb,
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity > 0), unit_cost_cents bigint NOT NULL DEFAULT 0,
  received_quantity numeric NOT NULL DEFAULT 0 CHECK (received_quantity >= 0), cancelled_quantity numeric NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),
  is_custom boolean NOT NULL DEFAULT false, customer_order_id uuid, customer_order_item_id uuid,
  expected_date date, supplier_notes text, display_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS commerce_po_items_po_idx ON commerce_po_items (tenant_id, po_id, display_order);

CREATE TABLE IF NOT EXISTS commerce_goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  po_id uuid NOT NULL REFERENCES commerce_purchase_orders(id) ON DELETE CASCADE, location_id uuid NOT NULL REFERENCES commerce_locations(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL, note text, photos jsonb NOT NULL DEFAULT '[]'::jsonb, received_by text, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS commerce_goods_receipts_idem_uniq ON commerce_goods_receipts (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS commerce_goods_receipts_po_idx ON commerce_goods_receipts (tenant_id, po_id);

CREATE TABLE IF NOT EXISTS commerce_goods_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES commerce_goods_receipts(id) ON DELETE CASCADE, po_item_id uuid NOT NULL REFERENCES commerce_po_items(id) ON DELETE CASCADE,
  accepted_quantity numeric NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0), damaged_quantity numeric NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0), note text);

DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY['commerce_suppliers','commerce_purchase_orders','commerce_po_items','commerce_goods_receipts','commerce_goods_receipt_items']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id())', t||'_tenant', t);
  END LOOP; END $$;

-- ── mark_po_incoming: when a PO is sent/confirmed, its quantities become expected 'incoming' stock. ──
CREATE OR REPLACE FUNCTION mark_po_incoming(p_tenant uuid, p_po_id uuid, p_location_id uuid, p_by text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it commerce_po_items%ROWTYPE; v_kind text; v_item uuid; lvl_before int;
BEGIN
  FOR it IN SELECT * FROM commerce_po_items WHERE tenant_id = p_tenant AND po_id = p_po_id LOOP
    v_kind := CASE WHEN it.variant_id IS NOT NULL THEN 'variant' ELSE 'product' END;
    v_item := COALESCE(it.variant_id, it.product_id, it.component_id);
    IF v_item IS NULL THEN CONTINUE; END IF;
    INSERT INTO commerce_inventory_levels(tenant_id, item_kind, item_id, location_id, incoming)
      VALUES (p_tenant, v_kind, v_item, p_location_id, it.quantity)
      ON CONFLICT (tenant_id, item_kind, item_id, location_id) DO UPDATE SET incoming = commerce_inventory_levels.incoming + EXCLUDED.incoming, updated_at = now()
      RETURNING incoming - it.quantity INTO lvl_before;
    INSERT INTO commerce_inventory_movements(tenant_id, item_kind, item_id, location_id, movement_type, quantity, reference_type, reference_id, before_qty, after_qty, created_by)
      VALUES (p_tenant, v_kind, v_item, p_location_id, 'purchase_receipt', it.quantity, 'purchase_order', p_po_id, lvl_before, lvl_before + it.quantity, p_by);
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END $$;

-- ── receive_po_items: transaction-safe, idempotent goods receipt (§12) ───────────────────────────────
-- p_lines = jsonb array of { po_item_id, accepted, damaged }. Increases on_hand for accepted, decreases
-- incoming, records damaged, updates PO item received + PO status, and (if the PO item is linked to a
-- customer order) increments that order item's received quantity WITHOUT un-allocating it. Idempotent
-- on p_idempotency_key.
CREATE OR REPLACE FUNCTION receive_po_items(p_tenant uuid, p_po_id uuid, p_location_id uuid, p_lines jsonb, p_received_by text, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing_id uuid; v_receipt_id uuid; ln jsonb; v_poi commerce_po_items%ROWTYPE; v_kind text; v_item uuid; v_acc numeric; v_dmg numeric; oh_before int; inc_before int;
        v_all_received boolean := true; v_any_received boolean := false;
BEGIN
  SELECT id INTO existing_id FROM commerce_goods_receipts WHERE tenant_id = p_tenant AND idempotency_key = p_idempotency_key;
  IF existing_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'receipt_id', existing_id, 'idempotent', true); END IF;

  INSERT INTO commerce_goods_receipts(tenant_id, po_id, location_id, idempotency_key, received_by)
    VALUES (p_tenant, p_po_id, p_location_id, p_idempotency_key, p_received_by) RETURNING id INTO v_receipt_id;

  FOR ln IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_poi FROM commerce_po_items WHERE tenant_id = p_tenant AND id = (ln->>'po_item_id')::uuid AND po_id = p_po_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_acc := COALESCE((ln->>'accepted')::numeric, 0); v_dmg := COALESCE((ln->>'damaged')::numeric, 0);
    IF v_acc <= 0 AND v_dmg <= 0 THEN CONTINUE; END IF;
    -- never receive more than outstanding (ordered − already received − cancelled) unless explicitly allowed
    IF v_poi.received_quantity + v_acc > v_poi.quantity THEN
      RETURN jsonb_build_object('ok', false, 'error', 'over_receipt', 'po_item_id', v_poi.id, 'ordered', v_poi.quantity, 'already_received', v_poi.received_quantity, 'attempted', v_acc);
    END IF;
    v_kind := CASE WHEN v_poi.variant_id IS NOT NULL THEN 'variant' ELSE 'product' END;
    v_item := COALESCE(v_poi.variant_id, v_poi.product_id, v_poi.component_id);

    INSERT INTO commerce_goods_receipt_items(tenant_id, receipt_id, po_item_id, accepted_quantity, damaged_quantity, note)
      VALUES (p_tenant, v_receipt_id, v_poi.id, v_acc, v_dmg, ln->>'note');

    IF v_item IS NOT NULL AND (v_acc > 0 OR v_dmg > 0) THEN
      SELECT on_hand, incoming INTO oh_before, inc_before FROM commerce_inventory_levels WHERE tenant_id = p_tenant AND item_kind = v_kind AND item_id = v_item AND location_id = p_location_id FOR UPDATE;
      IF NOT FOUND THEN oh_before := 0; inc_before := 0; INSERT INTO commerce_inventory_levels(tenant_id, item_kind, item_id, location_id) VALUES (p_tenant, v_kind, v_item, p_location_id); END IF;
      UPDATE commerce_inventory_levels
        SET on_hand = on_hand + v_acc, damaged = damaged + v_dmg, incoming = GREATEST(0, incoming - (v_acc + v_dmg)), updated_at = now()
        WHERE tenant_id = p_tenant AND item_kind = v_kind AND item_id = v_item AND location_id = p_location_id;
      IF v_acc > 0 THEN
        INSERT INTO commerce_inventory_movements(tenant_id, item_kind, item_id, location_id, movement_type, quantity, reference_type, reference_id, before_qty, after_qty, created_by)
          VALUES (p_tenant, v_kind, v_item, p_location_id, 'purchase_receipt', v_acc, 'goods_receipt', v_receipt_id, oh_before, oh_before + v_acc, p_received_by);
      END IF;
      IF v_dmg > 0 THEN
        INSERT INTO commerce_inventory_movements(tenant_id, item_kind, item_id, location_id, movement_type, quantity, reference_type, reference_id, created_by, note)
          VALUES (p_tenant, v_kind, v_item, p_location_id, 'damage', v_dmg, 'goods_receipt', v_receipt_id, p_received_by, 'received damaged');
      END IF;
    END IF;

    UPDATE commerce_po_items SET received_quantity = received_quantity + v_acc WHERE id = v_poi.id;
    -- Customer-linked receipt stays allocated to that order (just bump its received bucket).
    IF v_poi.customer_order_item_id IS NOT NULL AND v_acc > 0 THEN
      UPDATE commerce_order_items SET quantity_received = quantity_received + v_acc WHERE tenant_id = p_tenant AND id = v_poi.customer_order_item_id;
    END IF;
  END LOOP;

  -- PO status from received coverage.
  SELECT bool_and(received_quantity >= quantity), bool_or(received_quantity > 0) INTO v_all_received, v_any_received FROM commerce_po_items WHERE tenant_id = p_tenant AND po_id = p_po_id;
  UPDATE commerce_purchase_orders SET status = CASE WHEN v_all_received THEN 'received' WHEN v_any_received THEN 'partially_received' ELSE status END, updated_at = now() WHERE id = p_po_id;
  INSERT INTO commerce_events(tenant_id, entity_type, entity_id, type, payload, actor) VALUES (p_tenant, 'purchase_order', p_po_id, 'goods_received', jsonb_build_object('receiptId', v_receipt_id), p_received_by);
  RETURN jsonb_build_object('ok', true, 'receipt_id', v_receipt_id);
END $$;

REVOKE ALL ON FUNCTION mark_po_incoming(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION receive_po_items(uuid,uuid,uuid,jsonb,text,text) FROM PUBLIC, anon, authenticated;
