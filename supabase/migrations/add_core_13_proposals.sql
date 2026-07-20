-- ============================================================================
-- Core Proposals — unify Estimates + Quotes into ONE sales-document type with a full customer
-- lifecycle, a branded secure public page, view/accept/decline tracking, and conversion to
-- Invoice (Core RPC) / Order (legacy orders). Additive + idempotent.
--
-- Design: `proposals` shares the exact column shape of estimates/quotes/invoices so the existing
-- data layer (createDocument/getDocument/listDocuments/addLine), numbering (core_next_document_number)
-- and conversion RPC (core_convert_document) all work unchanged — we EXTEND, we do not build a second
-- sales system. Legacy `estimates`/`quotes` tables are left untouched for history; a unified read layer
-- (lib/core/proposals.ts) merges all three and old routes redirect into the proposal detail.
-- ============================================================================

CREATE TABLE IF NOT EXISTS proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number text NOT NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',                 -- draft|ready|sent|viewed|accepted|declined|expired|converted (free text, no CHECK — parity with estimates/quotes)
  currency text NOT NULL DEFAULT 'usd',
  subtotal_cents bigint NOT NULL DEFAULT 0,             -- Σ gross line amounts (qty × unit), before discounts
  discount_cents bigint NOT NULL DEFAULT 0,             -- Σ line discounts + overall_discount_cents (parity display)
  overall_discount_cents bigint NOT NULL DEFAULT 0,     -- document-level discount, on top of per-line discounts
  tax_cents bigint NOT NULL DEFAULT 0,                  -- document-level tax (user-entered cents)
  total_cents bigint NOT NULL DEFAULT 0,                -- max(0, subtotal − discount) + tax
  notes text,                                            -- parity column (kept for the shared repo); customer_notes is the surfaced one
  -- proposal-specific ---------------------------------------------------------
  salesperson_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz,
  customer_notes text,                                   -- shown on the public page
  internal_notes text,                                   -- never leaves the tenant
  terms text,                                            -- terms & conditions (public page)
  -- secure public page + lifecycle tracking -----------------------------------
  public_token_hash text,                                -- sha256 of the raw token; raw token ONLY ever in the link/email
  public_token_revoked_at timestamptz,                   -- revocation (a resend rotates the hash)
  sent_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  accepted_at timestamptz, accepted_by_name text, accepted_by_email text,
  declined_at timestamptz, declined_by_name text, declined_by_email text, decline_reason text,
  expired_at timestamptz,
  converted_at timestamptz,
  converted_invoice_id uuid,                             -- idempotency guard for Proposal -> Invoice
  converted_order_id uuid,                               -- idempotency guard for Proposal -> Order
  -- provenance / idempotency (parity with the other doc tables) ---------------
  source_document_type text, source_document_id uuid, conversion_key text,
  issued_at timestamptz, created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE UNIQUE INDEX IF NOT EXISTS proposals_number_uniq ON proposals (tenant_id, number);
CREATE UNIQUE INDEX IF NOT EXISTS proposals_convkey_uniq ON proposals (tenant_id, conversion_key) WHERE conversion_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS proposals_contact_idx ON proposals (tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS proposals_status_idx ON proposals (tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS proposals_public_token_uniq ON proposals (public_token_hash) WHERE public_token_hash IS NOT NULL;

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant proposals access" ON proposals;
CREATE POLICY "Tenant proposals access" ON proposals FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- Seed a friendlier numbering prefix (PROP-) for proposals; core_next_document_number would otherwise
-- default to 'PRO-'. ON CONFLICT DO NOTHING keeps this idempotent and never disturbs an existing counter.
INSERT INTO numbering_counters (tenant_id, doc_type, prefix, next_number)
  SELECT id, 'proposal', 'PROP-', 1 FROM tenants
  ON CONFLICT (tenant_id, doc_type) DO NOTHING;

-- Extend the document_type CHECK on the shared line + payment tables to include 'proposal'.
-- Robust drop: remove whatever the inline constraint was auto-named, then re-add with 'proposal'.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'sales_document_lines'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%document_type%' LOOP
    EXECUTE format('ALTER TABLE sales_document_lines DROP CONSTRAINT %I', r.conname);
  END LOOP;
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'payment_allocations'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%document_type%' LOOP
    EXECUTE format('ALTER TABLE payment_allocations DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE sales_document_lines ADD CONSTRAINT sales_document_lines_document_type_check
  CHECK (document_type IN ('estimate','quote','order','invoice','proposal'));
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_document_type_check
  CHECK (document_type IN ('estimate','quote','order','invoice','proposal'));

-- Conversion RPC: allow 'proposal' as a source. proposals shares the estimates/quotes column shape,
-- so `p_source_type || 's'` = 'proposals' resolves with zero special-casing. Targets stay quote/invoice
-- (Proposal -> Order is handled in the TS layer against the legacy orders system).
CREATE OR REPLACE FUNCTION core_convert_document(p_tenant uuid, p_source_type text, p_source_id uuid, p_target_type text, p_key text, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing uuid; v_new uuid; v_num text; v_hdr record;
BEGIN
  IF p_target_type NOT IN ('quote','invoice') OR p_source_type NOT IN ('estimate','quote','order','invoice','proposal') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unsupported_conversion');
  END IF;
  EXECUTE format('SELECT id FROM %I WHERE tenant_id=$1 AND conversion_key=$2', p_target_type || 's') INTO v_existing USING p_tenant, p_key;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'idempotent', true, 'target_type', p_target_type, 'target_id', v_existing); END IF;

  IF p_source_type IN ('estimate','quote','invoice','proposal') THEN
    EXECUTE format('SELECT contact_id, company_id, currency, subtotal_cents, discount_cents, tax_cents, total_cents, notes FROM %I WHERE id=$1 AND tenant_id=$2', p_source_type || 's')
      INTO v_hdr USING p_source_id, p_tenant;
  ELSE
    SELECT contact_id AS contact_id, NULL::uuid AS company_id, currency AS currency,
           subtotal_cents AS subtotal_cents, 0::bigint AS discount_cents, 0::bigint AS tax_cents,
           subtotal_cents AS total_cents, internal_notes AS notes
      INTO v_hdr FROM orders WHERE id = p_source_id AND tenant_id = p_tenant;
  END IF;
  IF v_hdr IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'source_not_found'); END IF;

  v_num := core_next_document_number(p_tenant, p_target_type);
  EXECUTE format('INSERT INTO %I (tenant_id, number, contact_id, company_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, notes, source_document_type, source_document_id, conversion_key, created_by) VALUES ($1,$2,$3,$4,''draft'',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id', p_target_type || 's')
    INTO v_new USING p_tenant, v_num, v_hdr.contact_id, v_hdr.company_id, v_hdr.currency, v_hdr.subtotal_cents, v_hdr.discount_cents, v_hdr.tax_cents, v_hdr.total_cents, v_hdr.notes, p_source_type, p_source_id, p_key, p_actor;

  INSERT INTO sales_document_lines (tenant_id, document_type, document_id, product_id, variant_id, component_id, description, quantity, unit_price_cents, discount_cents, tax_cents, line_total_cents, custom_attributes, sort_order)
    SELECT tenant_id, p_target_type, v_new, product_id, variant_id, component_id, description, quantity, unit_price_cents, discount_cents, tax_cents, line_total_cents, custom_attributes, sort_order
      FROM sales_document_lines WHERE tenant_id = p_tenant AND document_type = p_source_type AND document_id = p_source_id;

  INSERT INTO document_status_history (tenant_id, document_type, document_id, to_status, actor, note)
    VALUES (p_tenant, p_target_type, v_new, 'draft', p_actor, format('Converted from %s %s', p_source_type, p_source_id));

  RETURN jsonb_build_object('ok', true, 'target_type', p_target_type, 'target_id', v_new, 'number', v_num);
END $$;
REVOKE ALL ON FUNCTION core_convert_document(uuid,text,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS proposals CASCADE;
-- (restore the prior core_convert_document from add_core_10_component_commerce.sql and the 4-value CHECKs)
