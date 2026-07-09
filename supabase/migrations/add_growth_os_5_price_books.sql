-- Growth OS Sprint 5 — White Label / Reseller price books + client accounts.
-- Separate economics from commission_plans (affiliates/agencies keep those). billing_mode decides
-- which experience a partner sees. Idempotent. Seed rows are inserted via REST after this runs.

CREATE TABLE IF NOT EXISTS partner_price_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  billing_mode text NOT NULL CHECK (billing_mode IN ('white_label','reseller')),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partner_price_book_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_book_id uuid NOT NULL REFERENCES partner_price_books(id) ON DELETE CASCADE,
  plan_name text NOT NULL,
  plan_code text NOT NULL,
  wholesale_price_cents int NOT NULL DEFAULT 0,
  suggested_retail_price_cents int NOT NULL DEFAULT 0,
  setup_fee_cents int,
  included_ai_employees int,
  included_phone_numbers int,
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_price_book_items_book ON partner_price_book_items(price_book_id, sort_order);

-- Assign a price book + optional overrides to a white_label / reseller partner.
ALTER TABLE partners ADD COLUMN IF NOT EXISTS price_book_id uuid REFERENCES partner_price_books(id) ON DELETE SET NULL;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS custom_wholesale_discount_pct numeric(5,2);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS retail_markup_pct numeric(5,2);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS agreement_notes text;

-- Client accounts under a white_label / reseller partner. Overlay on the existing partner↔tenant
-- relation (referrals) with per-client pricing — never touches the commission ledger.
CREATE TABLE IF NOT EXISTS partner_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  business_name text,
  price_book_item_id uuid REFERENCES partner_price_book_items(id) ON DELETE SET NULL,
  plan_code text,
  retail_price_cents int,
  wholesale_price_cents int,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('prospect','active','paused','churned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_clients_partner ON partner_clients(partner_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_client_tenant ON partner_clients(partner_id, tenant_id) WHERE tenant_id IS NOT NULL;

-- RLS. Price books are admin/service-managed config; client accounts are partner-owned.
ALTER TABLE partner_price_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_price_book_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Partner clients own" ON partner_clients;
CREATE POLICY "Partner clients own" ON partner_clients FOR ALL USING (partner_id = get_partner_id()) WITH CHECK (partner_id = get_partner_id());
