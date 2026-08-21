-- ============================================================================
-- A SECOND LETTERHEAD, AND A CHOICE BETWEEN THEM
--
-- add_doc_letterhead.sql gave a tenant ONE piece of stationery, drawn from her tenant record and her
-- document-branding row. TG has two, and they are not two skins on one business: TG JEWELLERS signs
-- retail work on tgjewellers.com, T.G. DESIGNS signs trade work on tg-designs.com, from a Granville
-- suite, under a toll-free number the retail side does not publish. She confirmed the divergence is
-- deliberate. So the second letterhead cannot borrow the first one's contact row — it has to carry
-- its own, and that is the whole reason this migration adds a table rather than four more columns.
--
-- ── WHAT A "STYLE" IS, AND WHAT IT IS NOT ───────────────────────────────────────────────────────────
--
--   'band'  the design already shipped: solid colour bands top and bottom, the wordmark reversed out
--           in white, the contact row on the band.
--   'rule'  the new one: white paper, a serif wordmark and its social row on the left, contacts on
--           the right behind a vertical rule, the header closed by a full-width hairline, and a
--           full-bleed band only at the foot.
--
-- The style is the DRAWING. letterhead_profiles is the CONTENT — one row per (tenant, style), holding
-- that identity's own name, contacts and colour. A style with no row falls back to the tenant record
-- and studio_doc_settings, which is exactly today's behaviour: 'band' keeps working untouched for TG
-- and for every other tenant without a single row being written.
--
-- ── WHERE THE CHOICE LIVES ──────────────────────────────────────────────────────────────────────────
--
--   studio_doc_settings.letterhead_style   her DEFAULT, set once in Branding.
--   orders.letterhead_style                the OVERRIDE for one order's documents. Null means "use
--                                          the default", so changing the default moves every order
--                                          that never said otherwise — which is what a default is.
--
-- Per ORDER rather than per rendered document: an estimate and the invoice that follows it go to the
-- same customer for the same piece, and stationery that changed between them would read as two
-- businesses quoting one job.
--
-- ── THE STRIP OF PHOTOGRAPHY ────────────────────────────────────────────────────────────────────────
--
-- studio_doc_settings.letterhead_strip_url is the band of jewellery that prints above the footer, on
-- BOTH designs. A URL rather than a bundled file, so she can replace it with a sharper or a seasonal
-- one without a deploy — and because the file committed with this work is 482px wide, which is 57dpi
-- across 8.5in of paper and will look soft in print. That is a real limitation with a real fix: point
-- this column at a version at least 2550px wide.
--
-- Additive and idempotent. Safe to run more than once. Every read in the application is defensive, so
-- the app renders today's document on a database where this has not been run yet.
-- ============================================================================

-- ── The choice ──────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE studio_doc_settings
  -- 'band' is the default because it is what exists: a tenant who has already set up a letterhead must
  -- not find it redrawn by a migration.
  ADD COLUMN IF NOT EXISTS letterhead_style     text NOT NULL DEFAULT 'band',
  ADD COLUMN IF NOT EXISTS letterhead_strip_url text;

-- NULL, and deliberately not defaulted to 'band': null means "whatever the tenant's default is today",
-- and a backfilled 'band' would freeze every existing order onto the current default forever.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS letterhead_style text;

-- ── The content ─────────────────────────────────────────────────────────────────────────────────────
-- Every column is nullable: a profile OVERRIDES the tenant record where it has a value and is
-- transparent where it does not, the same fold document_templates already uses. A profile that only
-- names the business still inherits her phone number rather than printing a blank.
CREATE TABLE IF NOT EXISTS letterhead_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  style         text NOT NULL,
  -- What the picker shows. The one field that is NOT a fallback: "T.G. Designs" beside "TG Jewellers"
  -- is how she tells two pieces of stationery apart at a glance.
  name          text NOT NULL,
  business_name text,
  website       text,
  email         text,
  phone         text,
  address       text,          -- one line, as the artwork prints it
  tagline       text,
  instagram     text,
  facebook      text,
  youtube       text,
  -- Printed as its own line, in the accent colour, under the four contact rows. Its own column and not
  -- a second phone: it is a different number with a different label, and folding it into `phone` would
  -- put a toll-free number where a shop's direct line belongs.
  toll_free     text,
  accent_color  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, style)
);
CREATE INDEX IF NOT EXISTS letterhead_profiles_tenant_idx ON letterhead_profiles (tenant_id);

ALTER TABLE letterhead_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant letterhead_profiles access" ON letterhead_profiles;
CREATE POLICY "Tenant letterhead_profiles access" ON letterhead_profiles
  FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- ── TG's second identity, as data ───────────────────────────────────────────────────────────────────
--
-- Measured off the artwork she supplied (docs/customers/tg-jewellers/letterhead-tg-designs.jpg) and
-- inserted here rather than typed into a component, because these are her contact details and the
-- renderer must not know one tenant's phone number. It is a SEED, not a constant: every field below is
-- editable in Branding afterwards, and ON CONFLICT DO NOTHING means re-running this cannot overwrite a
-- correction she has since made.
--
-- The three social handles are left NULL on purpose. The artwork prints the Facebook, Instagram and
-- YouTube marks as marks — no usernames beside them — so the file states that she is on all three and
-- states nothing about which accounts. A guessed handle is a link to somebody else's page, so the row
-- of icons stays dark until she types them into Branding, at which point each icon appears.
INSERT INTO letterhead_profiles
  (tenant_id, style, name, business_name, website, email, phone, address, toll_free, accent_color)
SELECT 'e6f07ad7-c5a2-4997-b798-cca7e09e837f', 'rule', 'T.G. Designs', 'T.G. DESIGNS',
       'www.tgdiamondsjewellery.com', 'info@tg-designs.com', '+1.604.683.5633',
       '#622-736 Granville, Vancouver, BC V6Z 1G3, Canada',
       '+1800 337 0041', '#CB0B24'
WHERE EXISTS (SELECT 1 FROM tenants WHERE id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f')
ON CONFLICT (tenant_id, style) DO NOTHING;

-- The strip, on both of her letterheads. Only set where she has none, for the same reason.
UPDATE studio_doc_settings
   SET letterhead_strip_url = '/letterhead/ring-strip.jpg'
 WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f'
   AND letterhead_strip_url IS NULL;


-- ── Verify ──────────────────────────────────────────────────────────────────────────────────────────

-- Expect 'band' on every existing row: nobody's stationery changed by being migrated.
SELECT letterhead_style, count(*) FROM studio_doc_settings GROUP BY 1;

-- Expect one row, 'T.G. Designs' / 'rule', with tg-designs.com — NOT tgjewellers.com. The two contact
-- sets diverging is the point; if this row shows the retail domain, the seed was merged by hand.
SELECT style, name, website, email, toll_free FROM letterhead_profiles
 WHERE tenant_id = 'e6f07ad7-c5a2-4997-b798-cca7e09e837f';

-- Expect 0 everywhere: no order is pinned to a letterhead until somebody chooses one on a document.
SELECT count(*) AS orders_pinned_to_a_letterhead FROM orders WHERE letterhead_style IS NOT NULL;


-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
--   ALTER TABLE orders DROP COLUMN IF EXISTS letterhead_style;
--   ALTER TABLE studio_doc_settings
--     DROP COLUMN IF EXISTS letterhead_style,
--     DROP COLUMN IF EXISTS letterhead_strip_url;
--   DROP TABLE IF EXISTS letterhead_profiles;
--
-- Dropping letterhead_profiles deletes the second identity's contact set. Her documents fall back to
-- the tenant record — which is the RETAIL contact set — so a trade document would go out signed with
-- the retail domain rather than going out unbranded. Export the table before dropping it.
