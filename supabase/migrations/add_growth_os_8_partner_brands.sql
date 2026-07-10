-- Growth OS Sprint 8 — White Label Phase 2a: DB-driven partner branding, resolved by domain.
-- Makes Scalix invisible: name, logo, favicon, colors, support details, custom domain, powered-by.
-- Resolution is unauthenticated (login on a custom domain) so it runs via service role. Idempotent.

CREATE TABLE IF NOT EXISTS partner_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL UNIQUE REFERENCES partners(id) ON DELETE CASCADE,
  company_name text,
  logo_url text,
  favicon_url text,
  primary_color text,
  secondary_color text,
  support_email text,
  support_phone text,
  website text,
  custom_domain text UNIQUE,       -- e.g. app.aiflow.com → this partner's brand
  email_footer text,
  login_background_url text,
  powered_by_scalix boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_brands_domain ON partner_brands(custom_domain) WHERE custom_domain IS NOT NULL;

ALTER TABLE partner_brands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Partner brand own" ON partner_brands;
CREATE POLICY "Partner brand own" ON partner_brands FOR ALL USING (partner_id = get_partner_id()) WITH CHECK (partner_id = get_partner_id());
