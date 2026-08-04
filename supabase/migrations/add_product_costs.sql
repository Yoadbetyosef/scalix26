-- ============================================================================
-- Product cost & margin — Phase 1: the table, its RLS, and the per-tenant defaults.
--
-- What a product costs the business is not the same kind of data as what it sells for. A price is shown
-- to customers; a cost is the business's own margin structure. This lives in its own table for one
-- concrete reason: Postgres RLS grants or denies a ROW, never a column. A cost column on
-- catalog_products would be readable by anyone who can read the product at all, and no policy could
-- prevent it. Separation is what makes the privacy requirement enforceable rather than cosmetic.
--
-- Additive, idempotent. Safe to run more than once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS product_costs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  product_id     uuid NOT NULL UNIQUE REFERENCES catalog_products(id) ON DELETE CASCADE,

  -- What was actually paid, in the tenant's base currency. NULL means "not recorded yet" — a valid
  -- state, and deliberately distinct from 0, which would mean "this product is free".
  cost_primary   numeric CHECK (cost_primary   IS NULL OR cost_primary   >= 0),

  -- Reference only: the supplier's own invoice amount in their currency (EUR for an importer). It is
  -- never converted and never enters the arithmetic — it exists so the buyer can reconcile against the
  -- invoice in front of them. No FX rate is stored anywhere, because a stored rate is a wrong rate.
  cost_secondary numeric CHECK (cost_secondary IS NULL OR cost_secondary >= 0),

  shipping_cost  numeric NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  tariff_cost    numeric NOT NULL DEFAULT 0 CHECK (tariff_cost   >= 0),

  -- Snapshotted from the tenant default when the row is saved. Changing the default later must not
  -- silently rewrite what a product cost last quarter.
  markup_percent numeric NOT NULL DEFAULT 0 CHECK (markup_percent >= 0),

  -- GENERATED, not written by the application. The brief called for a stored result calculated
  -- server-side; a generated column is that guarantee taken to its end — the value cannot drift from
  -- its inputs, and no client, endpoint, or service-role script can write a number that disagrees with
  -- the components. NULL in, NULL out: a product with no cost recorded shows blank, never $0.00.
  computed_cost  numeric GENERATED ALWAYS AS (
    CASE WHEN cost_primary IS NULL THEN NULL
         ELSE (cost_primary + shipping_cost + tariff_cost) * (1 + markup_percent / 100)
    END
  ) STORED,

  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid
);

CREATE INDEX IF NOT EXISTS product_costs_tenant_idx ON product_costs (tenant_id);

-- ── Access ──────────────────────────────────────────────────────────────────────────────────────────
--
-- LIMITATION — READ THIS BEFORE ADDING TEAM ACCOUNTS.
-- This policy enforces TENANT ISOLATION only. It does NOT enforce cost visibility.
-- `canViewCosts` lives in the application layer (lib/workspace.ts) and nowhere else.
--
-- That is sufficient today only because tenancy is 1:1 — one tenant, one owning user — so "can reach
-- this tenant's rows" and "is allowed to see its costs" happen to be the same set of people. The moment
-- a tenant has more than one user (staff, a bookkeeper), that stops being true: every member would
-- satisfy get_tenant_id() and the database would hand them the cost rows, with only the UI in the way.
--
-- When multi-user tenancy arrives, this policy MUST gain a real predicate — a per-member
-- can_view_costs flag joined here — not merely a check in application code.
--
-- What the policy does cover: a White Label partner operating a client account cannot read these rows.
-- get_tenant_id() is `SELECT id FROM tenants WHERE user_id = auth.uid()`, and a partner's identity
-- comes from partner_members, never from tenants.user_id — so the subquery returns their own business
-- or nothing, never the client's. (Corollary: never create a client tenant with user_id set to a
-- partner's user id; that single row would defeat this.)

ALTER TABLE product_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner product_costs access" ON product_costs;
CREATE POLICY "Owner product_costs access" ON product_costs
  FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- ── Per-tenant defaults ─────────────────────────────────────────────────────────────────────────────
-- Added to `tenants`, which is where every other per-tenant setting already lives (timezone,
-- enabled_modules, review_automation_enabled). A separate settings table for three columns would be a
-- second pattern for no gain.
--
-- The defaults are only defaults. A tenant with no secondary currency never sees that field at all —
-- nothing about EUR, USD or 10% is assumed anywhere in the code.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cost_markup_percent     numeric NOT NULL DEFAULT 10 CHECK (cost_markup_percent >= 0);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cost_base_currency      text    NOT NULL DEFAULT 'USD';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cost_secondary_currency text;

-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS product_costs CASCADE;
-- ALTER TABLE tenants DROP COLUMN IF EXISTS cost_markup_percent,
--   DROP COLUMN IF EXISTS cost_base_currency, DROP COLUMN IF EXISTS cost_secondary_currency;
