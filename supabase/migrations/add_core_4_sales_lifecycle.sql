-- ============================================================================
-- Scalix Core — Phase 4: Sales Lifecycle (Estimate → Quote → Order → Invoice)
-- ============================================================================
-- Additive & non-destructive. Separate first-class document tables (estimates, quotes,
-- invoices); the legacy `orders` table stays as-is and participates via conversion. One
-- typed line table for the sales-doc family (financials in integer-cents columns; only
-- per-line custom attributes in jsonb). Atomic per-tenant numbering + an ATOMIC, IDEMPOTENT
-- conversion RPC that preserves header + lines and keeps documents INDEPENDENT afterward.
-- Real RLS on all new tables. Run in the Supabase SQL Editor. Idempotent.

-- ── per-tenant, per-doc-type numbering counters (Phase 7 makes formats configurable) ──
CREATE TABLE IF NOT EXISTS numbering_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  doc_type text NOT NULL,               -- estimate|quote|invoice|order|…
  prefix text NOT NULL DEFAULT '',
  padding integer NOT NULL DEFAULT 4,
  next_number bigint NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, doc_type));

CREATE OR REPLACE FUNCTION core_next_document_number(p_tenant uuid, p_doc_type text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prefix text; v_pad int; v_num bigint; v_default_prefix text;
BEGIN
  v_default_prefix := upper(left(p_doc_type, 3)) || '-';
  INSERT INTO numbering_counters (tenant_id, doc_type, prefix, next_number)
    VALUES (p_tenant, p_doc_type, v_default_prefix, 1)
    ON CONFLICT (tenant_id, doc_type) DO NOTHING;
  UPDATE numbering_counters SET next_number = next_number + 1
    WHERE tenant_id = p_tenant AND doc_type = p_doc_type
    RETURNING prefix, padding, next_number - 1 INTO v_prefix, v_pad, v_num;
  RETURN v_prefix || lpad(v_num::text, v_pad, '0');
END $$;

-- ── document header tables (estimates / quotes / invoices) ───────────────────
-- Common shape via a DO loop keeps them identical-but-separate (distinct types, distinct numbers).
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY['estimates','quotes','invoices']) LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        number text NOT NULL,
        contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
        company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
        status text NOT NULL DEFAULT 'draft',
        currency text NOT NULL DEFAULT 'usd',
        subtotal_cents bigint NOT NULL DEFAULT 0,
        discount_cents bigint NOT NULL DEFAULT 0,
        tax_cents bigint NOT NULL DEFAULT 0,
        total_cents bigint NOT NULL DEFAULT 0,
        notes text,
        source_document_type text, source_document_id uuid,   -- provenance (independent record, not a live link)
        conversion_key text,                                   -- idempotency: one target per (source, key)
        issued_at timestamptz, created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    $f$, t);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (tenant_id, number)', t||'_number_uniq', t);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (tenant_id, conversion_key) WHERE conversion_key IS NOT NULL', t||'_convkey_uniq', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id, contact_id)', t||'_contact_idx', t);
  END LOOP; END $$;

-- ── one typed line table for the sales-doc family ───────────────────────────
CREATE TABLE IF NOT EXISTS sales_document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('estimate','quote','order','invoice')),
  document_id uuid NOT NULL,
  product_id uuid REFERENCES catalog_products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  description text,
  quantity numeric NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_price_cents bigint NOT NULL DEFAULT 0,
  discount_cents bigint NOT NULL DEFAULT 0,
  tax_cents bigint NOT NULL DEFAULT 0,
  line_total_cents bigint NOT NULL DEFAULT 0,
  custom_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,   -- per-line vertical attrs (e.g. fabric); NOT financial
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_sales_lines_doc ON sales_document_lines (tenant_id, document_type, document_id, sort_order);

-- ── document status history ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_type text NOT NULL, document_id uuid NOT NULL,
  from_status text, to_status text NOT NULL, actor uuid, note text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_doc_status_hist ON document_status_history (tenant_id, document_type, document_id, created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY['numbering_counters','estimates','quotes','invoices','sales_document_lines','document_status_history']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id())', t||'_tenant', t);
  END LOOP; END $$;

-- ── atomic + idempotent conversion: Estimate→Quote→Order? (order legacy)→Invoice ──
-- Copies header + all lines to a NEW target document with its own number; records provenance and status
-- history. Idempotent on (source, p_key): a repeat returns the already-created target. Documents remain
-- INDEPENDENT — editing the source later never mutates the target.
CREATE OR REPLACE FUNCTION core_convert_document(p_tenant uuid, p_source_type text, p_source_id uuid, p_target_type text, p_key text, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing uuid; v_new uuid; v_num text; v_hdr record;
BEGIN
  IF p_target_type NOT IN ('quote','invoice') OR p_source_type NOT IN ('estimate','quote','order','invoice') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unsupported_conversion');
  END IF;
  -- idempotency: a target of this type already created from this source+key?
  EXECUTE format('SELECT id FROM %I WHERE tenant_id=$1 AND conversion_key=$2', p_target_type) INTO v_existing USING p_tenant, p_key;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'idempotent', true, 'target_type', p_target_type, 'target_id', v_existing); END IF;

  -- read the source header (estimates/quotes/invoices share columns; orders handled minimally)
  IF p_source_type IN ('estimate','quote','invoice') THEN
    EXECUTE format('SELECT contact_id, company_id, currency, subtotal_cents, discount_cents, tax_cents, total_cents, notes FROM %I WHERE id=$1 AND tenant_id=$2', p_source_type)
      INTO v_hdr USING p_source_id, p_tenant;
  ELSE
    SELECT contact_id, NULL::uuid, currency, subtotal_cents, 0, 0, subtotal_cents, internal_notes
      INTO v_hdr FROM orders WHERE id = p_source_id AND tenant_id = p_tenant;
  END IF;
  IF v_hdr IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'source_not_found'); END IF;

  v_num := core_next_document_number(p_tenant, p_target_type);
  EXECUTE format('INSERT INTO %I (tenant_id, number, contact_id, company_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, notes, source_document_type, source_document_id, conversion_key, created_by) VALUES ($1,$2,$3,$4,''draft'',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id', p_target_type)
    INTO v_new USING p_tenant, v_num, v_hdr.contact_id, v_hdr.company_id, v_hdr.currency, v_hdr.subtotal_cents, v_hdr.discount_cents, v_hdr.tax_cents, v_hdr.total_cents, v_hdr.notes, p_source_type, p_source_id, p_key, p_actor;

  -- copy lines (product/variant links + custom attributes + amounts preserved)
  INSERT INTO sales_document_lines (tenant_id, document_type, document_id, product_id, variant_id, description, quantity, unit_price_cents, discount_cents, tax_cents, line_total_cents, custom_attributes, sort_order)
    SELECT tenant_id, p_target_type, v_new, product_id, variant_id, description, quantity, unit_price_cents, discount_cents, tax_cents, line_total_cents, custom_attributes, sort_order
      FROM sales_document_lines WHERE tenant_id = p_tenant AND document_type = p_source_type AND document_id = p_source_id;

  INSERT INTO document_status_history (tenant_id, document_type, document_id, to_status, actor, note)
    VALUES (p_tenant, p_target_type, v_new, 'draft', p_actor, format('Converted from %s %s', p_source_type, p_source_id));

  RETURN jsonb_build_object('ok', true, 'target_type', p_target_type, 'target_id', v_new, 'number', v_num);
END $$;
REVOKE ALL ON FUNCTION core_next_document_number(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION core_convert_document(uuid,text,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
