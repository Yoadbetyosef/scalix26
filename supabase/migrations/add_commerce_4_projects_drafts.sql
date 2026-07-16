-- ============================================================================
-- Commerce module — Phase 2a: Projects, Design Drafts, Draft items, Spaces, Settings
-- ============================================================================
-- Depends on add_commerce_1_catalog.sql / _2_inventory.sql / _3_inventory_lockdown.sql.
-- Reservations + the reserve_inventory RPC are in add_commerce_5_reservations.sql.
-- Run in the Supabase SQL Editor. Idempotent. All tenant-scoped + RLS.

-- ── Projects: the top-level customer engagement (contains spaces, drafts, orders) ──────────────
CREATE TABLE IF NOT EXISTS commerce_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_number text NOT NULL,
  name          text NOT NULL,
  contact_id    uuid,
  customer_name text,
  project_type  text,                          -- generic: room design | renovation | retail order | …
  assigned_to   text,
  status        text NOT NULL DEFAULT 'planning'
                  CHECK (status IN ('planning','in_design','proposal_sent','won','lost','completed','archived')),
  billing_address  jsonb,
  delivery_address jsonb,
  requested_delivery_date date,
  currency      text NOT NULL DEFAULT 'usd',
  internal_notes text,
  customer_notes text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_projects_number_uniq ON commerce_projects (tenant_id, project_number);
CREATE INDEX IF NOT EXISTS commerce_projects_tenant_status_idx ON commerce_projects (tenant_id, status);

-- Generic "spaces" (rooms / zones / areas) inside a project — line items may be assigned to one.
CREATE TABLE IF NOT EXISTS commerce_project_spaces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES commerce_projects(id) ON DELETE CASCADE,
  name          text NOT NULL,
  space_type    text,
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_project_spaces_project_idx ON commerce_project_spaces (tenant_id, project_id);

-- Mood boards + revisions (lightweight in Phase 2 — schema present; deeper UI later).
CREATE TABLE IF NOT EXISTS commerce_moodboards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES commerce_projects(id) ON DELETE CASCADE,
  title      text,
  images     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_moodboards_project_idx ON commerce_moodboards (tenant_id, project_id);

CREATE TABLE IF NOT EXISTS commerce_project_revisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES commerce_projects(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  snapshot    jsonb NOT NULL,                  -- frozen design snapshot
  note        text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_project_revisions_project_idx ON commerce_project_revisions (tenant_id, project_id, version DESC);

-- ── Design Drafts (proposals/quotes). A project has 0..n drafts. version drives optimistic concurrency. ─
CREATE TABLE IF NOT EXISTS commerce_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    uuid REFERENCES commerce_projects(id) ON DELETE SET NULL,
  draft_number  text NOT NULL,
  name          text,
  contact_id    uuid,
  customer_name text,
  customer_email text,
  status        text NOT NULL DEFAULT 'working'
                  CHECK (status IN ('working','ready_for_review','sent_to_customer','customer_reviewing','changes_requested','approved','expired','converted','cancelled')),
  assigned_to   text,
  currency      text NOT NULL DEFAULT 'usd',
  billing_address  jsonb,
  delivery_address jsonb,
  requested_delivery_date date,
  expiration_date date,
  internal_notes text,
  customer_notes text,
  subtotal_cents      bigint NOT NULL DEFAULT 0,
  discount_cents      bigint NOT NULL DEFAULT 0,
  tax_cents           bigint NOT NULL DEFAULT 0,
  delivery_cents      bigint NOT NULL DEFAULT 0,
  additional_cents    bigint NOT NULL DEFAULT 0,
  total_cents         bigint NOT NULL DEFAULT 0,
  version       integer NOT NULL DEFAULT 1,    -- optimistic concurrency for autosave (§18)
  autosaved_at  timestamptz,
  converted_order_id uuid,                      -- link when converted (Phase 3)
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_drafts_number_uniq ON commerce_drafts (tenant_id, draft_number);
CREATE INDEX IF NOT EXISTS commerce_drafts_tenant_status_idx ON commerce_drafts (tenant_id, status);
CREATE INDEX IF NOT EXISTS commerce_drafts_project_idx ON commerce_drafts (tenant_id, project_id);

-- Draft line items carry COMMERCIAL SNAPSHOTS so later catalog edits never rewrite old drafts (§4).
CREATE TABLE IF NOT EXISTS commerce_draft_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  draft_id       uuid NOT NULL REFERENCES commerce_drafts(id) ON DELETE CASCADE,
  line_kind      text NOT NULL DEFAULT 'product'
                   CHECK (line_kind IN ('product','variant','bundle','component','service','custom','note')),
  product_id     uuid,                          -- references, but the snapshot is authoritative
  variant_id     uuid,
  bundle_id      uuid,
  space_id       uuid REFERENCES commerce_project_spaces(id) ON DELETE SET NULL,
  -- snapshots (frozen at add-time)
  description_snapshot text,
  sku_snapshot   text,
  price_cents_snapshot bigint,
  cost_cents_snapshot  bigint,
  options_snapshot jsonb,                       -- fabric/color/dimensions/selected options
  image_snapshot text,
  -- live editable
  quantity       numeric NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_price_cents bigint NOT NULL DEFAULT 0,
  discount_cents bigint NOT NULL DEFAULT 0,
  tax_status     text NOT NULL DEFAULT 'taxable',
  customer_notes text,
  internal_notes text,
  supplier_id    uuid,
  lead_time_days integer,
  requested_delivery_date date,
  line_status    text NOT NULL DEFAULT 'open',
  display_order  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_draft_items_draft_idx ON commerce_draft_items (tenant_id, draft_id, display_order);

-- ── Per-tenant module settings (default reservation behavior, §5) ──────────────────────────────
CREATE TABLE IF NOT EXISTS commerce_settings (
  tenant_id              uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  default_reservation_hours integer NOT NULL DEFAULT 48,   -- 0/NULL semantics: mode controls it
  reservation_mode       text NOT NULL DEFAULT 'hours'
                           CHECK (reservation_mode IN ('hours','until_draft_expiration','no_expiration')),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ── RLS (tenant isolation). Catalog-style tables get normal tenant write; quantity tables stay locked. ─
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'commerce_projects','commerce_project_spaces','commerce_moodboards','commerce_project_revisions',
    'commerce_drafts','commerce_draft_items','commerce_settings'])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id())', t||'_tenant', t);
  END LOOP;
END $$;
