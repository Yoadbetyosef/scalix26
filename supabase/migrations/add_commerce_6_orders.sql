-- ============================================================================
-- Commerce module — Phase 3: Customer Orders + transaction-safe Draft conversion
-- ============================================================================
-- Depends on migrations 1–5. Run in the Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS commerce_customer_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_number  text NOT NULL,
  project_id    uuid REFERENCES commerce_projects(id) ON DELETE SET NULL,
  draft_id      uuid REFERENCES commerce_drafts(id) ON DELETE SET NULL,
  contact_id    uuid,
  customer_name text,
  customer_email text,
  -- fulfillment status (kept SEPARATE from payment, §7)
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','awaiting_deposit','confirmed','partially_allocated','allocated',
                                    'purchasing_required','in_production','partially_received','ready_for_delivery',
                                    'delivered','completed','cancelled')),
  payment_status text NOT NULL DEFAULT 'not_invoiced'
                  CHECK (payment_status IN ('not_invoiced','invoiced','partially_paid','paid','overdue','refunded','voided')),
  currency      text NOT NULL DEFAULT 'usd',
  billing_address  jsonb,
  delivery_address jsonb,
  requested_delivery_date date,
  subtotal_cents   bigint NOT NULL DEFAULT 0,
  discount_cents   bigint NOT NULL DEFAULT 0,
  tax_cents        bigint NOT NULL DEFAULT 0,
  delivery_cents   bigint NOT NULL DEFAULT 0,
  additional_cents bigint NOT NULL DEFAULT 0,
  total_cents      bigint NOT NULL DEFAULT 0,
  internal_notes text,
  customer_notes text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_orders_number_uniq ON commerce_customer_orders (tenant_id, order_number);
CREATE INDEX IF NOT EXISTS commerce_orders_tenant_status_idx ON commerce_customer_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS commerce_orders_draft_idx ON commerce_customer_orders (tenant_id, draft_id);

-- Order line items carry the frozen commercial snapshot + the distinct quantity buckets (§7):
-- ordered / allocated / missing(derived) / received / delivered. Never one vague status.
CREATE TABLE IF NOT EXISTS commerce_order_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id       uuid NOT NULL REFERENCES commerce_customer_orders(id) ON DELETE CASCADE,
  draft_item_id  uuid,
  line_kind      text NOT NULL DEFAULT 'product',
  product_id     uuid, variant_id uuid, bundle_id uuid, space_id uuid,
  description_snapshot text, sku_snapshot text, price_cents_snapshot bigint, cost_cents_snapshot bigint, options_snapshot jsonb, image_snapshot text,
  quantity_ordered   numeric NOT NULL DEFAULT 0 CHECK (quantity_ordered >= 0),
  quantity_allocated numeric NOT NULL DEFAULT 0 CHECK (quantity_allocated >= 0),
  quantity_received  numeric NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_delivered numeric NOT NULL DEFAULT 0 CHECK (quantity_delivered >= 0),
  unit_price_cents bigint NOT NULL DEFAULT 0,
  supplier_id    uuid,
  line_status    text NOT NULL DEFAULT 'open',
  display_order  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_order_items_order_idx ON commerce_order_items (tenant_id, order_id, display_order);

DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY['commerce_customer_orders','commerce_order_items']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id())', t||'_tenant', t);
  END LOOP; END $$;

-- ── convert_draft_to_order: transaction-safe + IDEMPOTENT (§6) ────────────────────────────────────
-- Locks the draft; if already converted returns the same order (no duplicate). Copies items with frozen
-- snapshots, transfers the draft's ACTIVE reservations to the order, computes per-line allocation and
-- the overall order status (allocated / partially_allocated / purchasing_required), marks the draft
-- converted, links both ways, and writes a timeline event. Repeated calls never duplicate anything.
CREATE OR REPLACE FUNCTION convert_draft_to_order(p_tenant uuid, p_draft_id uuid, p_order_number text, p_created_by text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d commerce_drafts%ROWTYPE; v_order_id uuid; it commerce_draft_items%ROWTYPE;
        v_kind text; v_item uuid; v_alloc numeric; v_ordered_total numeric := 0; v_alloc_total numeric := 0;
BEGIN
  SELECT * INTO d FROM commerce_drafts WHERE tenant_id = p_tenant AND id = p_draft_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'draft_not_found'); END IF;
  IF d.converted_order_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'order_id', d.converted_order_id, 'idempotent', true); END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce_draft_items WHERE tenant_id = p_tenant AND draft_id = p_draft_id) THEN RETURN jsonb_build_object('ok', false, 'error', 'empty_draft'); END IF;

  INSERT INTO commerce_customer_orders(tenant_id, order_number, project_id, draft_id, contact_id, customer_name, customer_email, status, payment_status, currency, billing_address, delivery_address, requested_delivery_date, subtotal_cents, discount_cents, tax_cents, delivery_cents, additional_cents, total_cents, internal_notes, customer_notes, created_by)
    VALUES (p_tenant, p_order_number, d.project_id, d.id, d.contact_id, d.customer_name, d.customer_email, 'confirmed', 'not_invoiced', d.currency, d.billing_address, d.delivery_address, d.requested_delivery_date, d.subtotal_cents, d.discount_cents, d.tax_cents, d.delivery_cents, d.additional_cents, d.total_cents, d.internal_notes, d.customer_notes, p_created_by)
    RETURNING id INTO v_order_id;

  FOR it IN SELECT * FROM commerce_draft_items WHERE tenant_id = p_tenant AND draft_id = p_draft_id ORDER BY display_order LOOP
    v_kind := CASE WHEN it.variant_id IS NOT NULL THEN 'variant' ELSE 'product' END;
    v_item := COALESCE(it.variant_id, it.product_id);
    v_alloc := 0;
    IF v_item IS NOT NULL THEN
      SELECT COALESCE(SUM(quantity), 0) INTO v_alloc FROM commerce_reservations
        WHERE tenant_id = p_tenant AND draft_id = p_draft_id AND status = 'active' AND item_kind = v_kind AND item_id = v_item;
      v_alloc := LEAST(v_alloc, it.quantity); -- never allocate more than ordered
    END IF;
    INSERT INTO commerce_order_items(tenant_id, order_id, draft_item_id, line_kind, product_id, variant_id, bundle_id, space_id, description_snapshot, sku_snapshot, price_cents_snapshot, cost_cents_snapshot, options_snapshot, image_snapshot, quantity_ordered, quantity_allocated, unit_price_cents, supplier_id, display_order)
      VALUES (p_tenant, v_order_id, it.id, it.line_kind, it.product_id, it.variant_id, it.bundle_id, it.space_id, it.description_snapshot, it.sku_snapshot, it.price_cents_snapshot, it.cost_cents_snapshot, it.options_snapshot, it.image_snapshot, it.quantity, v_alloc, it.unit_price_cents, it.supplier_id, it.display_order);
    v_ordered_total := v_ordered_total + it.quantity;
    v_alloc_total := v_alloc_total + v_alloc;
  END LOOP;

  -- Transfer the draft's active reservations to the order (keep draft link for history).
  UPDATE commerce_reservations SET customer_order_id = v_order_id, updated_at = now()
    WHERE tenant_id = p_tenant AND draft_id = p_draft_id AND status = 'active';

  -- Fulfillment status from allocation coverage (§7).
  UPDATE commerce_customer_orders SET status = CASE
      WHEN v_alloc_total >= v_ordered_total AND v_ordered_total > 0 THEN 'allocated'
      WHEN v_alloc_total > 0 THEN 'partially_allocated'
      ELSE 'purchasing_required' END,
    updated_at = now() WHERE id = v_order_id;

  UPDATE commerce_drafts SET status = 'converted', converted_order_id = v_order_id, updated_at = now() WHERE id = p_draft_id;
  INSERT INTO commerce_events(tenant_id, entity_type, entity_id, type, payload, actor)
    VALUES (p_tenant, 'order', v_order_id, 'converted_from_draft', jsonb_build_object('draftId', p_draft_id, 'ordered', v_ordered_total, 'allocated', v_alloc_total), p_created_by);
  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id, 'ordered', v_ordered_total, 'allocated', v_alloc_total, 'missing', v_ordered_total - v_alloc_total);
END $$;

REVOKE ALL ON FUNCTION convert_draft_to_order(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
