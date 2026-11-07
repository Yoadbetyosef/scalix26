-- ============================================================================
-- ADDITIONAL CHARGES ON AN ORDER — shipping, insurance, CAD/CAM, casting,
-- certificates, commissions, card fees, currency exchange, duties, discounts,
-- reimbursements, general charges. See lib/orders/charges.ts.
--
-- Run in the Supabase SQL editor. One part, idempotent, additive. Until it is
-- run the order form hides the charges section and nothing else changes.
--
-- amount_cents is the SELLING amount and is SIGNED (discounts are negative), so
-- orders.subtotal_cents = sum(lines) + sum(charges) is a plain sum. cost_cents
-- is internal only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS order_charges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  charge_type   text NOT NULL DEFAULT 'general' CHECK (charge_type IN (
                  'shipping', 'shipping_insured', 'shipping_overnight', 'shipping_duties',
                  'adjustment', 'appraisal', 'cad_cam', 'casting', 'certificate', 'commission',
                  'credit_card_fee', 'currency_exchange', 'custom_jewellery',
                  'discount', 'reimbursement', 'general')),
  description   text,
  amount_cents  bigint NOT NULL DEFAULT 0,
  cost_cents    bigint CHECK (cost_cents IS NULL OR cost_cents >= 0),
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_charges_order_idx ON order_charges (tenant_id, order_id, display_order);

ALTER TABLE order_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant order_charges access" ON order_charges;
CREATE POLICY "Tenant order_charges access" ON order_charges FOR ALL
  USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- Verify: expect one row, 0 charges.
SELECT 'order_charges' AS table_name, count(*) AS charges FROM order_charges;

-- Reverse (only if no charges were entered — it drops them):
--   DROP TABLE IF EXISTS order_charges;
-- ============================================================================
