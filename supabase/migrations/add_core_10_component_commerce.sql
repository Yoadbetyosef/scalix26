-- ============================================================================
-- Scalix Core — Component Commerce: sellable components, component variants, component orders
-- ============================================================================
-- Additive & non-destructive. Extends the EXISTING product/component/variant/line tables (no duplicate
-- product tables) so a component is a first-class, independently sellable catalog item:
--   product_components  += description, component_type, cost_cents, track_inventory
--   product_variants    += cost_cents, qr_code_token, component_id  (a variant may belong to a PRODUCT or a
--                          COMPONENT — product_id relaxed to NULLable, guarded by a CHECK)
--   product_media       += component_id  (component/variant image galleries)
--   sales_document_lines+= component_id  (order one component, with optional component-variant, on its own)
--   core_convert_document now copies component_id so conversions preserve the component link
-- Furniture-specific fabric/color/dimension fields for COMPONENT and VARIANT scopes are seeded into the
-- Furniture PACKAGE (not Core, not React). Money stays integer cents. Run in a FRESH SQL Editor tab.

-- ── product_components: cost, description, type, inventory-tracking flag ──────
ALTER TABLE product_components
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS component_type text,
  ADD COLUMN IF NOT EXISTS cost_cents bigint,
  ADD COLUMN IF NOT EXISTS track_inventory boolean NOT NULL DEFAULT true;

-- ── product_variants: cost, own QR, optional component ownership ─────────────
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS cost_cents bigint,
  ADD COLUMN IF NOT EXISTS qr_code_token text,
  ADD COLUMN IF NOT EXISTS component_id uuid REFERENCES product_components(id) ON DELETE CASCADE;
UPDATE product_variants SET qr_code_token = gen_random_uuid()::text WHERE qr_code_token IS NULL;
ALTER TABLE product_variants ALTER COLUMN qr_code_token SET DEFAULT gen_random_uuid()::text;
ALTER TABLE product_variants ALTER COLUMN qr_code_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_variant_qr ON product_variants (qr_code_token);
-- a variant belongs to a product OR a component (at least one); existing rows have product_id, so this holds
ALTER TABLE product_variants ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_owner_chk;
ALTER TABLE product_variants ADD CONSTRAINT product_variants_owner_chk CHECK (product_id IS NOT NULL OR component_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_variants_component ON product_variants (tenant_id, component_id, sort_order);

-- ── product_media: component galleries ──────────────────────────────────────
ALTER TABLE product_media
  ADD COLUMN IF NOT EXISTS component_id uuid REFERENCES product_components(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_product_media_component ON product_media (tenant_id, component_id, sort_order);

-- ── sales_document_lines: order a component (with optional component-variant) ─
ALTER TABLE sales_document_lines
  ADD COLUMN IF NOT EXISTS component_id uuid REFERENCES product_components(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_lines_component ON sales_document_lines (tenant_id, component_id);

-- ── convert RPC: preserve component_id across conversions (re-declare with the fix) ──
CREATE OR REPLACE FUNCTION core_convert_document(p_tenant uuid, p_source_type text, p_source_id uuid, p_target_type text, p_key text, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing uuid; v_new uuid; v_num text; v_hdr record;
BEGIN
  IF p_target_type NOT IN ('quote','invoice') OR p_source_type NOT IN ('estimate','quote','order','invoice') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unsupported_conversion');
  END IF;
  EXECUTE format('SELECT id FROM %I WHERE tenant_id=$1 AND conversion_key=$2', p_target_type || 's') INTO v_existing USING p_tenant, p_key;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'idempotent', true, 'target_type', p_target_type, 'target_id', v_existing); END IF;

  IF p_source_type IN ('estimate','quote','invoice') THEN
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

  -- copy lines — now includes component_id (independent component ordering survives conversion)
  INSERT INTO sales_document_lines (tenant_id, document_type, document_id, product_id, variant_id, component_id, description, quantity, unit_price_cents, discount_cents, tax_cents, line_total_cents, custom_attributes, sort_order)
    SELECT tenant_id, p_target_type, v_new, product_id, variant_id, component_id, description, quantity, unit_price_cents, discount_cents, tax_cents, line_total_cents, custom_attributes, sort_order
      FROM sales_document_lines WHERE tenant_id = p_tenant AND document_type = p_source_type AND document_id = p_source_id;

  INSERT INTO document_status_history (tenant_id, document_type, document_id, to_status, actor, note)
    VALUES (p_tenant, p_target_type, v_new, 'draft', p_actor, format('Converted from %s %s', p_source_type, p_source_id));

  RETURN jsonb_build_object('ok', true, 'target_type', p_target_type, 'target_id', v_new, 'number', v_num);
END $$;
REVOKE ALL ON FUNCTION core_convert_document(uuid,text,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;

-- ── Furniture PACKAGE: fabric/color/dimension fields for COMPONENT + VARIANT scopes ──
-- (installPackage already materializes ALL scopes; seeding here keeps furniture specifics in the package.)
INSERT INTO vertical_schema_package_fields (package_id, entity_type, key, label, field_type, required, options, sort_order)
SELECT p.id, v.entity_type, v.key, v.label, v.field_type, false, v.options, v.sort_order
FROM vertical_schema_packages p
JOIN (VALUES
  ('component', 'fabric',    'Fabric',      'select',  '[{"value":"velvet","label":"Velvet"},{"value":"leather","label":"Leather"},{"value":"linen","label":"Linen"},{"value":"boucle","label":"Bouclé"}]'::jsonb, 0),
  ('component', 'color',     'Color',       'text',    '[]'::jsonb, 1),
  ('component', 'width_cm',  'Width (cm)',  'decimal', '[]'::jsonb, 2),
  ('component', 'height_cm', 'Height (cm)', 'decimal', '[]'::jsonb, 3),
  ('component', 'depth_cm',  'Depth (cm)',  'decimal', '[]'::jsonb, 4),
  ('variant',   'fabric',    'Fabric',      'select',  '[{"value":"velvet","label":"Velvet"},{"value":"leather","label":"Leather"},{"value":"linen","label":"Linen"},{"value":"boucle","label":"Bouclé"}]'::jsonb, 0),
  ('variant',   'color',     'Color',       'text',    '[]'::jsonb, 1)
) AS v(entity_type, key, label, field_type, options, sort_order) ON p.key = 'furniture'
ON CONFLICT (package_id, entity_type, key) DO UPDATE
  SET label = EXCLUDED.label, field_type = EXCLUDED.field_type, options = EXCLUDED.options, sort_order = EXCLUDED.sort_order;
