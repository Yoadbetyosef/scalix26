-- ============================================================================
-- Orders module — Phase 4: jewelry specs, tenant-managed dropdowns, custom-design orders.
--
-- Driven by TG jewellers' requirements: line items need real jewelry attributes (stone quality/colour,
-- natural vs lab grown, stone type, shapes, carat weights, metal karat) chosen from dropdowns the tenant
-- edits herself — never a developer. Custom orders additionally need a requirements section and a flag.
--
-- Design note: line items store the option's LABEL, not a foreign key. A line item is a commercial
-- snapshot (same reasoning as line_total_cents) — renaming or retiring "VS1" later must never rewrite or
-- break an order placed years ago. The option tables drive what the dropdown OFFERS, nothing more.
--
-- Additive, idempotent. Safe to run more than once.
-- ============================================================================

-- ── Tenant-managed dropdown lists ───────────────────────────────────────────────────────────────────
-- One row per dropdown (stone quality, stone colour, …). Seeded with sensible jewelry defaults below;
-- the tenant then adds/renames/reorders/deactivates entries from Settings.

CREATE TABLE IF NOT EXISTS order_option_lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  key           text NOT NULL,                    -- stable machine key the app looks up (never edited by the tenant)
  label         text NOT NULL,                    -- what the tenant sees: "Stone quality"
  display_order int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS order_option_lists_tenant_key_idx ON order_option_lists (tenant_id, key);

CREATE TABLE IF NOT EXISTS order_options (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  list_id       uuid NOT NULL REFERENCES order_option_lists(id) ON DELETE CASCADE,
  label         text NOT NULL,
  display_order int  NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,    -- deactivate hides it from new orders; history keeps its text
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_options_list_idx ON order_options (list_id, display_order);
-- Case-insensitive uniqueness per list, so "Round" can't be added twice as "round".
CREATE UNIQUE INDEX IF NOT EXISTS order_options_list_label_idx ON order_options (list_id, lower(label));

ALTER TABLE order_option_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_options      ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant order_option_lists access" ON order_option_lists;
CREATE POLICY "Tenant order_option_lists access" ON order_option_lists FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());
DROP POLICY IF EXISTS "Tenant order_options access" ON order_options;
CREATE POLICY "Tenant order_options access" ON order_options FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- ── Jewelry attributes on line items ────────────────────────────────────────────────────────────────
-- Text columns hold the chosen option label; carats are numeric so they can be totalled and sorted.

ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS stone_quality          text;
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS stone_color            text;
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS stone_origin           text;   -- Natural | Lab Grown
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS stone_type             text;   -- Diamond | Ruby | …
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS center_stone_shape     text;
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS side_stone_shape       text;
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS center_stone_carat     numeric CHECK (center_stone_carat IS NULL OR center_stone_carat >= 0);
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS side_stone_carat_total numeric CHECK (side_stone_carat_total IS NULL OR side_stone_carat_total >= 0);
ALTER TABLE order_line_items ADD COLUMN IF NOT EXISTS metal_karat            text;   -- 14K White Gold | Platinum | …

-- ── Custom-design orders ────────────────────────────────────────────────────────────────────────────

ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_requirements text;                          -- detailed brief for bespoke work
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_custom_design    boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS orders_tenant_custom_idx ON orders (tenant_id, is_custom_design) WHERE is_custom_design;

-- ── Contact currency ────────────────────────────────────────────────────────────────────────────────
-- Selecting a saved contact on an order auto-fills their usual currency alongside email/phone/address.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS currency text;

-- ── Seed the default lists for tenants that already have Orders enabled ─────────────────────────────
-- Idempotent: a list is only created if absent, and options are only inserted for lists created fresh,
-- so re-running never resurrects an option the tenant deliberately deleted.

DO $$
DECLARE
  t        record;
  spec     record;
  new_list uuid;
  seeds    jsonb := jsonb_build_object(
    'stone_quality',      jsonb_build_array('FL','IF','VVS1','VVS2','VS1','VS2','SI1','SI2','I1','I2','I3'),
    'stone_color',        jsonb_build_array('D','E','F','G','H','I','J','K','L','M','Fancy Yellow','Fancy Pink','Fancy Blue'),
    'stone_origin',       jsonb_build_array('Natural','Lab Grown'),
    'stone_type',         jsonb_build_array('Diamond','Ruby','Sapphire','Emerald','Moissanite','Aquamarine','Tanzanite','Morganite','Amethyst','Topaz','Garnet','Peridot','Tourmaline','Opal','Pearl'),
    'center_stone_shape', jsonb_build_array('Round','Oval','Princess','Cushion','Emerald','Pear','Marquise','Radiant','Asscher','Heart','Trillion','Baguette'),
    'side_stone_shape',   jsonb_build_array('Round','Oval','Princess','Cushion','Emerald','Pear','Marquise','Radiant','Asscher','Heart','Trillion','Baguette','Tapered Baguette'),
    'metal_karat',        jsonb_build_array('10K Yellow Gold','10K White Gold','10K Rose Gold','14K Yellow Gold','14K White Gold','14K Rose Gold','18K Yellow Gold','18K White Gold','18K Rose Gold','Platinum','Sterling Silver')
  );
BEGIN
  FOR t IN SELECT id FROM tenants WHERE enabled_modules @> ARRAY['orders'] LOOP
    FOR spec IN
      SELECT * FROM (VALUES
        ('stone_quality',      'Stone quality',            1),
        ('stone_color',        'Stone colour',             2),
        ('stone_origin',       'Natural or Lab Grown',     3),
        ('stone_type',         'Stone type',               4),
        ('center_stone_shape', 'Center stone shape',       5),
        ('side_stone_shape',   'Side stone shape',         6),
        ('metal_karat',        'Gold karat / metal',       7)
      ) AS v(key, label, ord)
    LOOP
      -- Only seed options when the list itself is newly created.
      INSERT INTO order_option_lists (tenant_id, key, label, display_order)
      VALUES (t.id, spec.key, spec.label, spec.ord)
      ON CONFLICT (tenant_id, key) DO NOTHING
      RETURNING id INTO new_list;

      IF new_list IS NOT NULL THEN
        INSERT INTO order_options (tenant_id, list_id, label, display_order)
        SELECT t.id, new_list, value, (ordinality - 1)::int
        FROM jsonb_array_elements_text(seeds -> spec.key) WITH ORDINALITY AS s(value, ordinality);
      END IF;
      new_list := NULL;
    END LOOP;
  END LOOP;
END $$;

-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS order_options, order_option_lists CASCADE;
-- ALTER TABLE order_line_items DROP COLUMN IF EXISTS stone_quality, DROP COLUMN IF EXISTS stone_color,
--   DROP COLUMN IF EXISTS stone_origin, DROP COLUMN IF EXISTS stone_type, DROP COLUMN IF EXISTS center_stone_shape,
--   DROP COLUMN IF EXISTS side_stone_shape, DROP COLUMN IF EXISTS center_stone_carat,
--   DROP COLUMN IF EXISTS side_stone_carat_total, DROP COLUMN IF EXISTS metal_karat;
-- ALTER TABLE orders DROP COLUMN IF EXISTS client_requirements, DROP COLUMN IF EXISTS is_custom_design;
-- ALTER TABLE contacts DROP COLUMN IF EXISTS currency;
