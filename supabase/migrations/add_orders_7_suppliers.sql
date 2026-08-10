-- ORDERS 7 — SUPPLIERS (factories / workshops) AS REAL RECORDS
--
-- Today a factory exists only as three free-text columns retyped on every order
-- (orders.factory_name / factory_contact_name / factory_email). Seven orders in one tenant have already
-- produced five spellings of two factories — "Tatiana", "Tatiana factory", "t", "prive" all on
-- tatiana@tg-designs.com, and "Nancy " / "Nansy" on gio.creations22@gmail.com. Nothing can be looked up,
-- reused, or corrected in one place, and "Move to Production" had no address to send to unless a full
-- factory-approval cycle had already run.
--
-- The table ships EMPTY. Collapsing the existing rows by address would have turned four spellings on
-- tatiana@tg-designs.com into one supplier, and there is no way to tell from here whether "prive" is that
-- same workshop or a different one reached at the same address. Merging a business's records on a guess is
-- not reversible by the person who has to live with the result. The first send to a factory creates its
-- record instead; the factory_* columns on older orders stay exactly as typed, as history.
--
-- Suppliers get their own table rather than a row in `contacts`. `contacts` is the CRM: it carries
-- channel, total_conversations, last_interaction, and it feeds lead lists, drip campaigns and AI outreach.
-- A factory that landed in there would eventually be marketed to. They are a different kind of party and
-- they get a different table.


-- ── 1. THE SUPPLIER ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  -- The business: "Gio Creations". contact_name is the person there: "Nancy".
  name          text NOT NULL,
  contact_name  text,
  email         text,
  phone         text,
  notes         text,
  -- Archived rather than deleted: orders that were made by this supplier must keep pointing at them.
  archived_at   timestamptz,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS suppliers_tenant_idx ON suppliers (tenant_id, archived_at, name);

-- One live supplier per address per tenant. This is what stops the four-spellings problem returning:
-- picking an existing supplier is possible, and creating a second one on the same email is not.
-- Partial, so archived rows never block reusing an address, and suppliers without an email are allowed
-- (a local workshop reached by phone is still a supplier).
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tenant_email_key
  ON suppliers (tenant_id, lower(email)) WHERE email IS NOT NULL AND archived_at IS NULL;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant suppliers access" ON suppliers;
CREATE POLICY "Tenant suppliers access" ON suppliers
  FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());


-- ── 2. THE LINK FROM AN ORDER ───────────────────────────────────────────────────────────────────────
-- ON DELETE SET NULL, not CASCADE: removing a supplier must never delete orders.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_supplier_idx ON orders (supplier_id) WHERE supplier_id IS NOT NULL;

COMMENT ON COLUMN orders.supplier_id IS
  'The factory/workshop making this piece. The factory_name/factory_contact_name/factory_email columns are kept as the historic record of what was typed on older orders; supplier_id is the source of truth from here.';


-- ── 3. WHO A WORK ORDER WENT TO ─────────────────────────────────────────────────────────────────────
-- order_approval_requests is already the machinery for sending a factory a spec-only page (no prices) and
-- receiving the invoice back. It records recipient_email as free text, so after the fact there is no way
-- to ask "everything we ever sent this supplier". This ties each request to the record from the next send
-- onward. Existing rows keep a null supplier_id rather than being matched by address — same reasoning as
-- above: an email match is a guess about identity, and this column is meant to be the answer to that
-- question, not another source of it.
ALTER TABLE order_approval_requests
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS order_approval_requests_supplier_idx
  ON order_approval_requests (supplier_id) WHERE supplier_id IS NOT NULL;
