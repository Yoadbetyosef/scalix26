-- ============================================================================
-- Orders, phase 6 — send an estimate, invoice a finished job, Canadian tax, and per-company
-- document templates.
--
-- ONE file, five concerns, because they ship together and a half-applied set leaves the UI reading
-- columns that are not there. Additive and idempotent throughout: no column is dropped, no CHECK is
-- tightened, and every new column is nullable or defaulted, so running this against a live database
-- changes no existing row's behaviour.
--
-- The application is written to survive this file NOT having been run — every new table and column is
-- read defensively and falls back to today's behaviour. Deploy order is therefore forgiving, but the
-- intended one is: run this, then deploy.
-- ============================================================================


-- ── 1. SHARING A DOCUMENT WITH THE CUSTOMER ─────────────────────────────────────────────────────────
--
-- An estimate could only be printed. There was no way to send one, because an order document lives
-- behind requireOrdersAccess() and the customer has no account.
--
-- This is a SHARE, not an approval. order_approval_requests already carries tokens, hashing, revocation
-- and expiry, and reusing that table was tempting — but an approval request means "please decide", it
-- drives the order's stage, and it is answered. A shared estimate asks for nothing and must never move
-- a stage. Folding the two together would have made every future reader ask which rows are decisions
-- and which are documents. Same token machinery (lib/orders/approval-token.ts), separate table.
CREATE TABLE IF NOT EXISTS order_document_shares (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  doc_type        text NOT NULL CHECK (doc_type IN ('estimate','quote','invoice')),
  -- SHA-256 of the raw token. The raw value exists only in the emailed link and is never stored.
  token_hash      text NOT NULL UNIQUE,
  recipient_name  text,
  recipient_email text NOT NULL,
  sent_at         timestamptz,
  revoked_at      timestamptz,
  -- NULL = never expires. A customer may open an estimate weeks later, and a link that dies silently
  -- is worse than one that lives: the failure lands on them, not on the business.
  expires_at      timestamptz,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_document_shares_order_idx ON order_document_shares (order_id);
ALTER TABLE order_document_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant order_document_shares access" ON order_document_shares;
CREATE POLICY "Tenant order_document_shares access" ON order_document_shares
  FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());


-- ── 2. FINISHING A JOB ──────────────────────────────────────────────────────────────────────────────
--
-- A completed order had nowhere to go, so finished work was re-entered by hand in another system.
-- Two timestamps rather than a status enum: they are independent facts. A job can be invoiced and not
-- archived, archived and not invoiced, or both, and an enum would force an order between them that
-- the business does not have.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoiced_at  timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS archived_at  timestamptz;
COMMENT ON COLUMN orders.invoiced_at IS 'When an invoice was raised from this order. Independent of archived_at.';
COMMENT ON COLUMN orders.archived_at IS 'When the finished piece was copied into the catalog. Independent of invoiced_at.';


-- ── 3. CANADIAN TAX, BY PLACE OF SUPPLY ─────────────────────────────────────────────────────────────
--
-- Tax follows the DELIVERY DESTINATION, not the seller's address: a BC business delivering to Ontario
-- charges 13% HST. So the province belongs on the ORDER, not on the tenant.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_province text;
COMMENT ON COLUMN orders.delivery_province IS 'Place of supply — the destination province code (BC, ON, …). Decides the tax rate, NOT the seller''s own province.';

-- Rates live in a TABLE because they change: Nova Scotia dropped from 15% to 14% in April 2025, and a
-- rate compiled into the application means a deploy to correct arithmetic that is already wrong on
-- documents that have gone out.
--
-- effective_from, and no effective_to: a rate is current until a later row supersedes it, so
-- correcting history is an INSERT rather than an UPDATE and the old figure stays readable. An invoice
-- raised last year can still be explained.
CREATE TABLE IF NOT EXISTS tax_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country        text NOT NULL DEFAULT 'CA',
  region         text NOT NULL,                      -- province / territory code
  label          text NOT NULL,                      -- what appears on the document: GST, HST, GST+PST
  rate_percent   numeric(6,3) NOT NULL CHECK (rate_percent >= 0),
  effective_from date NOT NULL DEFAULT '2000-01-01',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country, region, effective_from)
);
-- Readable by anyone: a public estimate page has no session and still has to show the tax line.
-- There is nothing tenant-specific or confidential in a statutory rate.
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tax rates are public" ON tax_rates;
CREATE POLICY "Tax rates are public" ON tax_rates FOR SELECT USING (true);

INSERT INTO tax_rates (country, region, label, rate_percent, effective_from) VALUES
  ('CA','BC','GST + PST', 12,     '2000-01-01'),
  ('CA','AB','GST',        5,     '2000-01-01'),
  ('CA','SK','GST + PST', 11,     '2000-01-01'),
  ('CA','MB','GST + PST', 12,     '2000-01-01'),
  ('CA','ON','HST',       13,     '2000-01-01'),
  ('CA','QC','GST + QST', 14.975, '2000-01-01'),
  ('CA','NB','HST',       15,     '2000-01-01'),
  ('CA','NS','HST',       14,     '2025-04-01'),
  ('CA','PE','HST',       15,     '2000-01-01'),
  ('CA','NL','HST',       15,     '2000-01-01'),
  ('CA','YT','GST',        5,     '2000-01-01'),
  ('CA','NT','GST',        5,     '2000-01-01'),
  ('CA','NU','GST',        5,     '2000-01-01')
ON CONFLICT (country, region, effective_from) DO NOTHING;

-- Nova Scotia's pre-2025 rate, so a document raised before the change can still be explained. The
-- lookup takes the newest row not later than the document's date.
INSERT INTO tax_rates (country, region, label, rate_percent, effective_from) VALUES
  ('CA','NS','HST', 15, '2000-01-01')
ON CONFLICT (country, region, effective_from) DO NOTHING;


-- ── 4. DOCUMENT TEMPLATES ───────────────────────────────────────────────────────────────────────────
--
-- One business can trade under more than one name — TG Jewellers retail and TG Designs B2B — and each
-- needs its own logo, details and terms on the paperwork. Built as a general capability: any tenant
-- can define any number, and a tenant with none behaves exactly as it does today.
--
-- The columns mirror what loadDocContext() already assembles from studio_doc_settings + tenants, so a
-- template is a complete OVERRIDE rather than a patch. A partial override would mean every field
-- needing a "which source won" rule, and two sources of truth for an address.
CREATE TABLE IF NOT EXISTS document_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  name          text NOT NULL,                       -- what the picker shows: "TG Jewellers (Retail)"
  company_name  text,
  logo_url      text,
  accent_color  text,
  email         text,
  phone         text,
  website       text,
  address       text,
  city          text,
  state         text,
  zip           text,
  terms         text,
  validity_days integer,
  footer_note   text,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_templates_tenant_idx ON document_templates (tenant_id);
-- At most one default per tenant, enforced by the database rather than by whichever code path last
-- wrote a row.
CREATE UNIQUE INDEX IF NOT EXISTS document_templates_one_default
  ON document_templates (tenant_id) WHERE is_default;
ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant document_templates access" ON document_templates;
CREATE POLICY "Tenant document_templates access" ON document_templates
  FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- ON DELETE SET NULL: deleting a template must not delete the orders that used it. They fall back to
-- the tenant's own details, which is the behaviour they had before templates existed.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS document_template_id uuid
  REFERENCES document_templates(id) ON DELETE SET NULL;


-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
--   ALTER TABLE orders DROP COLUMN IF EXISTS document_template_id;
--   ALTER TABLE orders DROP COLUMN IF EXISTS delivery_province;
--   ALTER TABLE orders DROP COLUMN IF EXISTS archived_at;
--   ALTER TABLE orders DROP COLUMN IF EXISTS invoiced_at;
--   DROP TABLE IF EXISTS document_templates;
--   DROP TABLE IF EXISTS tax_rates;
--   DROP TABLE IF EXISTS order_document_shares;
--
-- Dropping order_document_shares revokes every estimate link that has been sent. That is the correct
-- consequence and worth stating: the links stop working, they do not silently show the wrong thing.
