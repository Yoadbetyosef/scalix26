-- ============================================================================
-- Orders module — Phase 1: orders, line items, activity timeline.
-- Tenant-scoped via RLS (get_tenant_id()), same pattern as other tenant tables. Additive, idempotent.
-- The Orders module is opt-in per tenant (enabled_modules); this migration only creates the data model.
-- ============================================================================

-- Stages (V1 workflow). Approval stages change only via explicit workflow actions (enforced in app code).
--   new · waiting_factory_approval · factory_changes_requested · factory_approved ·
--   waiting_customer_approval · customer_changes_requested · customer_approved ·
--   production · ready · delivered · completed · cancelled

CREATE TABLE IF NOT EXISTS orders (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  order_number              text NOT NULL,                    -- non-sequential public reference (e.g. ORD-7F3K9Q)
  contact_id                uuid,                             -- optional reference to contacts (no duplication)
  customer_name             text,
  customer_email            text,
  customer_phone            text,
  stage                     text NOT NULL DEFAULT 'new' CHECK (stage IN ('new','waiting_factory_approval','factory_changes_requested','factory_approved','waiting_customer_approval','customer_changes_requested','customer_approved','production','ready','delivered','completed','cancelled')),
  factory_name              text,
  factory_contact_name      text,
  factory_email             text,
  assigned_employee         text,
  order_date                date,
  requested_completion_date date,
  estimated_completion_date date,
  subtotal_cents            bigint NOT NULL DEFAULT 0,
  deposit_cents             bigint NOT NULL DEFAULT 0,
  balance_cents             bigint NOT NULL DEFAULT 0,
  currency                  text NOT NULL DEFAULT 'usd',
  internal_notes            text,                             -- NEVER exposed on the public approval page
  public_notes              text,
  created_by                text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_number_idx ON orders (tenant_id, order_number);
CREATE INDEX IF NOT EXISTS orders_tenant_stage_idx ON orders (tenant_id, stage);
CREATE INDEX IF NOT EXISTS orders_tenant_created_idx ON orders (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_line_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name      text NOT NULL,
  description       text,
  sku               text,
  quantity          numeric NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_price_cents  bigint NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  measurements      text,
  color             text,
  material          text,
  custom_spec       text,
  product_ref       uuid,                                     -- optional reference to inventory/catalog item
  line_total_cents  bigint NOT NULL DEFAULT 0,                -- commercial snapshot (qty × unit price)
  display_order     int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_line_items_order_idx ON order_line_items (order_id, display_order);

CREATE TABLE IF NOT EXISTS order_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type        text NOT NULL,                                  -- created|updated|stage_changed|approval_sent|approval_opened|approval_responded|approval_revoked|note|sent_to_production
  actor       text,                                           -- user email / 'factory' / 'customer' / 'system'
  payload     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events (order_id, created_at DESC);

ALTER TABLE orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_line_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_events      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant orders access" ON orders;
CREATE POLICY "Tenant orders access" ON orders FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());
DROP POLICY IF EXISTS "Tenant order_line_items access" ON order_line_items;
CREATE POLICY "Tenant order_line_items access" ON order_line_items FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());
DROP POLICY IF EXISTS "Tenant order_events access" ON order_events;
CREATE POLICY "Tenant order_events access" ON order_events FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS order_events, order_line_items, orders CASCADE;
