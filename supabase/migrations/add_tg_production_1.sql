-- ============================================================================
-- TG PRODUCTION READINESS, ROUND 1 — one file, nine independent parts.
-- Run in the Supabase SQL editor. Every part is idempotent and safe to re-run.
--
-- ── RUN THE PARTS ONE AT A TIME, IN ORDER ──────────────────────────────────
--
-- Paste and run PART 1, read its verify output, then PART 2, and so on. A
-- hand-run migration pasted whole once hit an error in a later statement and
-- rolled the WHOLE thing back silently. Nine separate runs cannot do that:
-- each part stands alone and nothing below depends on anything above.
--
-- ── HOW THE APP KNOWS WHICH PARTS ARE APPLIED ──────────────────────────────
--
-- Every part creates (IF NOT EXISTS) a tiny `schema_flags` table and, as its
-- LAST statement, inserts its own key. The editor runs a pasted part as one
-- transaction, so the flag lands only when the whole part did. The application
-- reads that table once (lib/db/capabilities.ts) and hides or disables exactly
-- the actions a missing part would break — it never probes missing tables and
-- never shows a database error to a person.
--
-- ── WHAT THE APP DOES BEFORE THIS IS RUN ───────────────────────────────────
--
-- Everything is additive. Every new column is read off the row with a
-- fallback and every write retries without it, so an unmigrated database
-- renders exactly as it does today. What does NOT work until each part runs:
--
--   PART 1  moving an order to "In Process" (23514 until the CHECK knows it)
--   PART 2  recording a payment by wire / e-transfer with its own date — the
--           app stores 'transfer' and today's date until then, and says so
--   PART 3  nothing — the backfill only carries typed deposits into the ledger
--   PART 4  memos and consignment (the table does not exist)
--   PART 5  purchases from suppliers on an order (the table does not exist)
--   PART 6  repair / appraisal order kinds (column read as 'custom' until then)
--   PART 7  asking a factory for a quotation (columns absent → plain approval)
--   PART 8  nothing visible — data: TG's website knowledge scoped to the
--           agent that scanned it, and her piece-type list gains four types
--   PART 9  nothing visible — data: orders typed as walk-ins linked to the
--           contact whose email they carry
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- PART 1 — THE 'in_process' STAGE
--
-- A verbal yes, before the deposit and before any formal approval is answered.
-- CONSTRAINT ONLY. No existing row changes stage.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schema_flags (key text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE schema_flags ENABLE ROW LEVEL SECURITY;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_stage_check;
ALTER TABLE orders ADD CONSTRAINT orders_stage_check
  CHECK (stage IN (
    'new',
    'pending',
    'in_process',       -- NEW: verbally approved, paperwork and deposit to follow
    'waiting_factory_approval', 'factory_changes_requested', 'factory_approved',
    'waiting_customer_approval', 'customer_changes_requested', 'customer_approved',
    'production', 'ready', 'delivered',
    'completed',
    'finished',
    'closed_no_sale',
    'cancelled'
  ));

-- the flag the application reads to know this part is applied (lib/db/capabilities.ts)
INSERT INTO schema_flags (key) VALUES ('tg_production_1.part1') ON CONFLICT DO NOTHING;

-- verify: the constraint lists sixteen stages and no row is outside it
SELECT pg_get_constraintdef(oid) AS orders_stage_check FROM pg_constraint WHERE conname = 'orders_stage_check';
SELECT count(*) AS rows_outside_constraint FROM orders WHERE stage NOT IN (
  'new','pending','in_process','waiting_factory_approval','factory_changes_requested','factory_approved',
  'waiting_customer_approval','customer_changes_requested','customer_approved','production','ready','delivered',
  'completed','finished','closed_no_sale','cancelled');


-- ════════════════════════════════════════════════════════════════════════════
-- PART 2 — THE PAYMENT LEDGER LEARNS TWO CANADIAN WORDS AND A DATE
--
-- payment_allocations is the platform's ledger and already admits
-- document_type = 'order'. TG records deposits by wire and by e-transfer, and
-- needs the date the money arrived (a cheque dated Friday, banked Monday).
--
-- The RPC is recreated with the wider method list so core's own path accepts
-- the same words. Everything else in it is byte-identical to add_payment_method.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schema_flags (key text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE schema_flags ENABLE ROW LEVEL SECURITY;

ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS paid_on date;
COMMENT ON COLUMN payment_allocations.paid_on IS
  'The date the money was received, as recorded by the person entering it. NULL = not recorded; readers fall back to created_at.';

ALTER TABLE payment_allocations DROP CONSTRAINT IF EXISTS payment_allocations_method_check;
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_method_check
  CHECK (method IS NULL OR method IN ('transfer', 'zelle', 'cash', 'cheque', 'card', 'other', 'wire', 'etransfer'));
COMMENT ON COLUMN payment_allocations.method IS
  'How the money arrived: transfer | zelle | cash | cheque | card | other | wire | etransfer. NULL on rows recorded before this column existed — absent, not "other". ''transfer'' is the older word for wire/e-transfer; rows written before the two were distinguished may carry it.';

CREATE OR REPLACE FUNCTION core_apply_payment(
  p_tenant uuid, p_doc_type text, p_doc_id uuid, p_kind text, p_amount_cents bigint,
  p_currency text, p_provider_ref text, p_key text, p_actor uuid,
  p_method text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_exists uuid; v_signed bigint; v_total bigint; v_paid bigint; v_balance bigint; v_status text;
BEGIN
  IF p_kind NOT IN ('charge','deposit','refund','adjustment') THEN RETURN jsonb_build_object('ok', false, 'error', 'bad_kind'); END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('transfer','zelle','cash','cheque','card','other','wire','etransfer') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_method');
  END IF;
  IF p_key IS NOT NULL THEN
    SELECT id INTO v_exists FROM payment_allocations WHERE tenant_id = p_tenant AND idempotency_key = p_key;
    IF v_exists IS NOT NULL THEN
      SELECT COALESCE(SUM(amount_cents),0) INTO v_paid FROM payment_allocations WHERE tenant_id = p_tenant AND document_type = p_doc_type AND document_id = p_doc_id;
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'paid_cents', v_paid);
    END IF;
  END IF;
  v_signed := CASE WHEN p_kind = 'refund' THEN -abs(p_amount_cents) ELSE abs(p_amount_cents) END;
  INSERT INTO payment_allocations (tenant_id, document_type, document_id, kind, amount_cents, currency, provider_ref, idempotency_key, created_by, method)
    VALUES (p_tenant, p_doc_type, p_doc_id, p_kind, v_signed, COALESCE(p_currency,'usd'), p_provider_ref, p_key, p_actor, p_method);

  SELECT COALESCE(SUM(amount_cents),0) INTO v_paid FROM payment_allocations WHERE tenant_id = p_tenant AND document_type = p_doc_type AND document_id = p_doc_id;
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

-- the flag the application reads to know this part is applied (lib/db/capabilities.ts)
INSERT INTO schema_flags (key) VALUES ('tg_production_1.part2') ON CONFLICT DO NOTHING;

-- verify: paid_on exists; the method constraint names eight words
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'payment_allocations' AND column_name IN ('paid_on', 'method');
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'payment_allocations_method_check';


-- ════════════════════════════════════════════════════════════════════════════
-- PART 3 — TYPED DEPOSITS BECOME LEDGER ROWS
--
-- orders.deposit_cents used to be typed into a form. It is now DERIVED: the sum
-- of the ledger rows for that order. An order with a typed deposit and no rows
-- would have its deposit vanish the first time a second payment was recorded
-- (the app guards against that too — lib/orders/payments.ts carryLegacyDeposit
-- — but a database-wide pass is the honest conversion). One row per such
-- order, kind 'deposit', dated the order date, with a note saying where it
-- came from. Nothing is changed on the orders table.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schema_flags (key text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE schema_flags ENABLE ROW LEVEL SECURITY;

INSERT INTO payment_allocations (tenant_id, document_type, document_id, kind, amount_cents, currency, note, idempotency_key, paid_on)
SELECT o.tenant_id, 'order', o.id, 'deposit', o.deposit_cents, COALESCE(o.currency, 'usd'),
       'Deposit recorded before payment history existed',
       'legacy-deposit:' || o.id::text,
       COALESCE(o.order_date, o.created_at::date)
FROM orders o
WHERE o.deposit_cents > 0
  AND NOT EXISTS (
    SELECT 1 FROM payment_allocations p
    WHERE p.tenant_id = o.tenant_id AND p.document_type = 'order' AND p.document_id = o.id
  )
ON CONFLICT DO NOTHING;

-- the flag the application reads to know this part is applied (lib/db/capabilities.ts)
INSERT INTO schema_flags (key) VALUES ('tg_production_1.part3') ON CONFLICT DO NOTHING;

-- verify: every order with a typed deposit now has ledger rows summing to it
SELECT count(*) AS orders_with_deposit,
       count(*) FILTER (WHERE (SELECT COALESCE(SUM(amount_cents),0) FROM payment_allocations p WHERE p.document_type='order' AND p.document_id=o.id) = o.deposit_cents) AS matching_ledger
FROM orders o WHERE o.deposit_cents > 0;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 4 — MEMOS AND CONSIGNMENT
--
-- An item sent OUT on memo (ours, in a customer's or dealer's hands) or
-- received IN on memo / consignment (a supplier's, in ours). Ownership is a
-- column, never inferred from status — see lib/memos/README in the code.
--
-- Inventory follows the memo through the existing catalog movement ledger,
-- which gains three movement types and one counter (on_memo_quantity). A
-- product received on memo carries ownership 'memo_in' or 'consignment' so it
-- is never counted as company-owned stock.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schema_flags (key text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE schema_flags ENABLE ROW LEVEL SECURITY;

ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS ownership text NOT NULL DEFAULT 'owned';
ALTER TABLE catalog_products DROP CONSTRAINT IF EXISTS catalog_products_ownership_check;
ALTER TABLE catalog_products ADD CONSTRAINT catalog_products_ownership_check
  CHECK (ownership IN ('owned', 'memo_in', 'consignment'));
COMMENT ON COLUMN catalog_products.ownership IS
  'Who owns this stock: owned (ours) | memo_in (a supplier''s, here on memo) | consignment (a supplier''s, here on consignment). Never company stock unless owned.';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS on_memo_quantity integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN catalog_products.on_memo_quantity IS
  'Units of OUR stock currently out on memo with a customer or dealer. Not in any location and not available; comes back on return.';

ALTER TABLE catalog_movements DROP CONSTRAINT IF EXISTS catalog_movements_movement_type_check;
ALTER TABLE catalog_movements ADD CONSTRAINT catalog_movements_movement_type_check
  CHECK (movement_type IN ('receive','move','sell','adjust','return','memo_out','memo_return','memo_in','memo_return_supplier'));

CREATE TABLE IF NOT EXISTS memos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind                text NOT NULL DEFAULT 'memo' CHECK (kind IN ('memo', 'consignment')),
  direction           text NOT NULL CHECK (direction IN ('out', 'in')),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'follow_up', 'pending_decision', 'sold', 'returned')),
  -- What the item is. A catalog row when it is stock (out) or was entered as one (in); free text otherwise.
  catalog_product_id  uuid REFERENCES catalog_products(id) ON DELETE SET NULL,
  item_description    text NOT NULL,
  quantity            integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  from_location       text,
  -- Who has it / whose it is. out: the customer or dealer (contact); in: the supplier.
  contact_id          uuid REFERENCES contacts(id) ON DELETE SET NULL,
  supplier_id         uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  counterparty_name   text,
  -- Ownership is EXPLICIT: out = ours ('company'); in = theirs ('counterparty').
  owner               text NOT NULL CHECK (owner IN ('company', 'counterparty')),
  agreed_price_cents  bigint,
  cost_cents          bigint,
  currency            text NOT NULL DEFAULT 'usd',
  moved_on            date NOT NULL DEFAULT CURRENT_DATE,
  due_on              date,
  sold_on             date,
  returned_on         date,
  sold_price_cents    bigint,
  settled_at          timestamptz,
  order_id            uuid REFERENCES orders(id) ON DELETE SET NULL,
  notes               text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memos_tenant_status_idx ON memos (tenant_id, status, due_on);
CREATE INDEX IF NOT EXISTS memos_contact_idx ON memos (tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS memos_product_idx ON memos (tenant_id, catalog_product_id);

CREATE TABLE IF NOT EXISTS memo_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  memo_id     uuid NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  type        text NOT NULL,
  actor       uuid,
  payload     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memo_events_memo_idx ON memo_events (memo_id, created_at);

ALTER TABLE memos ENABLE ROW LEVEL SECURITY;
ALTER TABLE memo_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant memos access" ON memos;
CREATE POLICY "Tenant memos access" ON memos FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());
DROP POLICY IF EXISTS "Tenant memo_events access" ON memo_events;
CREATE POLICY "Tenant memo_events access" ON memo_events FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- the flag the application reads to know this part is applied (lib/db/capabilities.ts)
INSERT INTO schema_flags (key) VALUES ('tg_production_1.part4') ON CONFLICT DO NOTHING;

-- verify
SELECT column_name FROM information_schema.columns WHERE table_name = 'catalog_products' AND column_name IN ('ownership', 'on_memo_quantity');
SELECT count(*) AS memos FROM memos;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 5 — PURCHASES FROM SUPPLIERS, ON AN ORDER
--
-- The stone bought for a ring, the mounting ordered from the caster. Linked to
-- the order they are for (nullable: stock purchases exist), to the supplier,
-- and optionally to the supplier's invoice as an order attachment.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schema_flags (key text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE schema_flags ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS order_purchases (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id               uuid REFERENCES orders(id) ON DELETE CASCADE,
  supplier_id            uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name          text,
  kind                   text NOT NULL DEFAULT 'other' CHECK (kind IN ('stone', 'mounting', 'finding', 'casting', 'service', 'other')),
  description            text NOT NULL,
  quantity               integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  cost_cents             bigint,
  currency               text NOT NULL DEFAULT 'usd',
  reference              text,
  status                 text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'waiting', 'in_production', 'shipped', 'received', 'qc_done')),
  ordered_on             date,
  expected_on            date,
  received_on            date,
  qc_note                text,
  invoice_attachment_id  uuid REFERENCES order_attachments(id) ON DELETE SET NULL,
  notes                  text,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_purchases_order_idx ON order_purchases (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS order_purchases_status_idx ON order_purchases (tenant_id, status, expected_on);
ALTER TABLE order_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant order_purchases access" ON order_purchases;
CREATE POLICY "Tenant order_purchases access" ON order_purchases FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- the flag the application reads to know this part is applied (lib/db/capabilities.ts)
INSERT INTO schema_flags (key) VALUES ('tg_production_1.part5') ON CONFLICT DO NOTHING;

-- verify
SELECT count(*) AS purchases FROM order_purchases;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 6 — WHAT KIND OF JOB AN ORDER IS
--
-- A repair and an appraisal are ORDERS: same customer, same stages, same
-- payments, same documents, same history. What differs is a few words on the
-- form and the document, and for an appraisal a purpose. One column, one JSON
-- pocket, no second table. Every existing order is 'custom'.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schema_flags (key text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE schema_flags ENABLE ROW LEVEL SECURITY;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_kind text NOT NULL DEFAULT 'custom';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_kind_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_kind_check
  CHECK (order_kind IN ('custom', 'repair', 'appraisal', 'stock'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS kind_details jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN orders.order_kind IS 'custom (bespoke/made) | repair | appraisal | stock (a piece sold from inventory). Labels on the form and the document follow it.';
COMMENT ON COLUMN orders.kind_details IS 'Kind-specific fields: repair {itemDescription, repairRequested}; appraisal {purpose, appraiser, itemDescription}.';

-- the flag the application reads to know this part is applied (lib/db/capabilities.ts)
INSERT INTO schema_flags (key) VALUES ('tg_production_1.part6') ON CONFLICT DO NOTHING;

-- verify
SELECT order_kind, count(*) FROM orders GROUP BY 1;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 7 — ASKING A FACTORY FOR A QUOTATION
--
-- The factory link already carries the specification, the attachments and a
-- yes/no. A quotation request is the same link asking a different question,
-- and the answer is a number. Two columns on the existing request row.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schema_flags (key text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE schema_flags ENABLE ROW LEVEL SECURITY;

ALTER TABLE order_approval_requests ADD COLUMN IF NOT EXISTS request_kind text NOT NULL DEFAULT 'approval';
ALTER TABLE order_approval_requests DROP CONSTRAINT IF EXISTS order_approval_requests_request_kind_check;
ALTER TABLE order_approval_requests ADD CONSTRAINT order_approval_requests_request_kind_check
  CHECK (request_kind IN ('approval', 'quote'));
ALTER TABLE order_approval_requests ADD COLUMN IF NOT EXISTS quoted_cost_cents bigint;
COMMENT ON COLUMN order_approval_requests.request_kind IS 'approval: please approve this piece. quote: please tell us what it would cost.';
COMMENT ON COLUMN order_approval_requests.quoted_cost_cents IS 'What the factory said it would cost, in the order''s currency. Internal — never on a customer document.';

-- the flag the application reads to know this part is applied (lib/db/capabilities.ts)
INSERT INTO schema_flags (key) VALUES ('tg_production_1.part7') ON CONFLICT DO NOTHING;

-- verify
SELECT request_kind, count(*) FROM order_approval_requests GROUP BY 1;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 8 — DATA: KNOWLEDGE STAYS WITH THE BUSINESS THAT OWNS IT, AND FOUR
--          PIECE TYPES
--
-- 8a. TG is one tenant and two businesses (three AI employees are planned).
--     Website-scanned knowledge was written tenant-wide, so Vancouver Gem Lab's
--     appraisal pages were being read by the TG Jewellers agent — and each
--     agent's scan DELETED the other's. Rows whose origin agent is known are
--     scoped to that agent.
--
--     TG's TENANT ONLY. The first draft applied this to every tenant with more
--     than one agent, and that is wrong for the demo tenant (fea1d3c6), whose
--     two agents are one business sharing one website — their scan must stay
--     shared. Verified 2026-09-14: TG is the only multi-business tenant.
--
--     These three rows were already re-scoped by hand on 2026-09-14 (the leak
--     was live). This statement is what makes that reproducible: on production
--     it updates 0 rows; on a rebuilt environment it does the same fix.
--
-- 8b. TG's own piece-type list gains Chain, Watch, Loose stone and Other —
--     appended, active, after whatever she already has. Nothing renamed. TG is
--     the only tenant with a product_type list (verified), and the statement
--     is pinned to her tenant regardless.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schema_flags (key text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE schema_flags ENABLE ROW LEVEL SECURITY;

UPDATE knowledge_base k
SET ai_employee_id = k.origin_ai_employee_id
WHERE k.tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
  AND k.ai_employee_id IS NULL
  AND k.origin_ai_employee_id IS NOT NULL
  AND k.source = 'website'
  AND EXISTS (SELECT 1 FROM ai_employees a WHERE a.id = k.origin_ai_employee_id AND a.tenant_id = k.tenant_id);

INSERT INTO order_options (tenant_id, list_id, label, display_order, active)
SELECT l.tenant_id, l.id, v.label,
       (SELECT COALESCE(max(display_order), 0) FROM order_options o WHERE o.list_id = l.id) + v.ord,
       true
FROM order_option_lists l
CROSS JOIN (VALUES ('Chain', 1), ('Watch', 2), ('Loose stone', 3), ('Other', 4)) AS v(label, ord)
WHERE l.key = 'product_type'
  AND l.tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
  AND NOT EXISTS (SELECT 1 FROM order_options o WHERE o.list_id = l.id AND lower(o.label) = lower(v.label));

-- the flag the application reads to know this part is applied (lib/db/capabilities.ts)
INSERT INTO schema_flags (key) VALUES ('tg_production_1.part8') ON CONFLICT DO NOTHING;

-- verify
SELECT title, ai_employee_id, origin_ai_employee_id FROM knowledge_base WHERE source = 'website' AND tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f';
SELECT o.label, o.active FROM order_options o JOIN order_option_lists l ON l.id = o.list_id
WHERE l.key = 'product_type' AND l.tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f' ORDER BY o.display_order;


-- ════════════════════════════════════════════════════════════════════════════
-- PART 9 — DATA: WALK-IN ORDERS LINKED TO THE CONTACT THEY BELONG TO
--
-- 21 of TG's 36 orders carried typed customer details and no contact_id. The
-- rule, the same one scripts/audit-order-contacts.mjs applies and reports on:
--
--   SAFE AUTO-LINK  the order's email matches EXACTLY ONE live contact in the
--                   tenant (case-insensitive), or — with no email match — its
--                   phone matches exactly one contact on the last ten digits.
--   AMBIGUOUS       more than one contact matches: left alone, listed.
--   NO MATCH        nothing matches: left alone (no contact is invented from
--                   free text — "STOCK" and "None" are not people).
--
-- Never by name. Nothing on the order changes but contact_id. Idempotent: an
-- order that already has a contact is skipped. The script was run first on
-- production (2026-09-14); this statement is the same rule for a rebuilt
-- environment and updates 0 rows where the script already ran.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schema_flags (key text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE schema_flags ENABLE ROW LEVEL SECURITY;

-- The business's OWN addresses are placeholders, not customers: the tenant email, its agents'
-- and letterheads' emails, and everything on their domains (gmail-style domains excluded). A match
-- on one of these is refused — seven of TG's orders carry tatiana@tg-designs.com typed in for
-- other people's pieces, and linking "Andrea's ring" to Tatiana's own record would be wrong.
CREATE OR REPLACE FUNCTION tg_is_business_address(p_tenant uuid, p_email text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  WITH own AS (
    SELECT lower(trim(e)) AS email FROM (
      SELECT t.email AS e FROM tenants t WHERE t.id = p_tenant
      UNION ALL SELECT a.email FROM ai_employees a WHERE a.tenant_id = p_tenant
      UNION ALL SELECT a.reply_from_email FROM ai_employees a WHERE a.tenant_id = p_tenant
      UNION ALL SELECT l.email FROM letterhead_profiles l WHERE l.tenant_id = p_tenant
    ) x WHERE e IS NOT NULL AND e LIKE '%@%'
  )
  SELECT p_email IS NOT NULL AND (
    lower(trim(p_email)) IN (SELECT email FROM own)
    OR split_part(lower(trim(p_email)), '@', 2) IN (
      SELECT split_part(email, '@', 2) FROM own
      WHERE split_part(email, '@', 2) NOT IN ('gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com')
    )
  )
$$;

-- 9a. By email, exactly one live contact, not a business address.
UPDATE orders o
SET contact_id = (
  SELECT c.id FROM contacts c
  WHERE c.tenant_id = o.tenant_id AND c.merged_into_id IS NULL AND c.archived_at IS NULL
    AND lower(trim(c.email)) = lower(trim(o.customer_email))
)
WHERE o.contact_id IS NULL AND o.customer_email IS NOT NULL AND trim(o.customer_email) <> ''
  AND NOT tg_is_business_address(o.tenant_id, o.customer_email)
  AND (SELECT count(*) FROM contacts c
       WHERE c.tenant_id = o.tenant_id AND c.merged_into_id IS NULL AND c.archived_at IS NULL
         AND lower(trim(c.email)) = lower(trim(o.customer_email))) = 1;

-- 9b. By phone (last ten digits), exactly one live contact, for orders 9a did not link and that
--     have NO email match at all (an email that matched a business address is not retried by phone).
UPDATE orders o
SET contact_id = (
  SELECT c.id FROM contacts c
  WHERE c.tenant_id = o.tenant_id AND c.merged_into_id IS NULL AND c.archived_at IS NULL
    AND NOT tg_is_business_address(o.tenant_id, c.email)
    AND right(regexp_replace(c.phone, '\D', '', 'g'), 10) = right(regexp_replace(o.customer_phone, '\D', '', 'g'), 10)
)
WHERE o.contact_id IS NULL AND o.customer_phone IS NOT NULL
  AND length(regexp_replace(o.customer_phone, '\D', '', 'g')) >= 7
  AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.tenant_id = o.tenant_id AND c.merged_into_id IS NULL AND c.archived_at IS NULL
                    AND o.customer_email IS NOT NULL AND lower(trim(c.email)) = lower(trim(o.customer_email)))
  AND (SELECT count(*) FROM contacts c
       WHERE c.tenant_id = o.tenant_id AND c.merged_into_id IS NULL AND c.archived_at IS NULL
         AND NOT tg_is_business_address(o.tenant_id, c.email)
         AND right(regexp_replace(c.phone, '\D', '', 'g'), 10) = right(regexp_replace(o.customer_phone, '\D', '', 'g'), 10)) = 1;

-- the flag the application reads to know this part is applied (lib/db/capabilities.ts)
INSERT INTO schema_flags (key) VALUES ('tg_production_1.part9') ON CONFLICT DO NOTHING;

-- verify: how many orders now have a contact, per tenant
SELECT tenant_id, count(*) FILTER (WHERE contact_id IS NOT NULL) AS linked, count(*) AS total FROM orders GROUP BY 1;
