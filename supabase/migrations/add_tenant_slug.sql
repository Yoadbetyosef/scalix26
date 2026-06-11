-- Migration: human-readable per-tenant slug for the public booking link /f/<slug>
-- Run this in Supabase SQL Editor for existing databases.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS slug TEXT;

-- Slug generator: lowercase business_name, spaces -> '-', strip special chars,
-- collapse/trim dashes, then ensure uniqueness with a numeric suffix.
CREATE OR REPLACE FUNCTION set_tenant_slug() RETURNS trigger AS $$
DECLARE
  base TEXT;
  candidate TEXT;
  n INT := 2;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
    RETURN NEW;
  END IF;
  base := trim(both '-' from regexp_replace(
            regexp_replace(
              regexp_replace(lower(coalesce(NEW.business_name, 'business')), '\s+', '-', 'g'),
              '[^a-z0-9-]', '', 'g'
            ),
            '-+', '-', 'g'
          ));
  IF base = '' THEN base := 'business'; END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM tenants WHERE slug = candidate) LOOP
    candidate := base || '-' || n;
    n := n + 1;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_tenant_slug ON tenants;
CREATE TRIGGER trg_set_tenant_slug BEFORE INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_tenant_slug();

-- Backfill slugs for all existing tenants (same logic, one at a time to keep
-- the numeric suffixes unique and deterministic).
DO $$
DECLARE
  t RECORD;
  base TEXT;
  candidate TEXT;
  n INT;
BEGIN
  FOR t IN SELECT id, business_name FROM tenants WHERE slug IS NULL OR slug = '' ORDER BY created_at, id LOOP
    base := trim(both '-' from regexp_replace(
              regexp_replace(
                regexp_replace(lower(coalesce(t.business_name, 'business')), '\s+', '-', 'g'),
                '[^a-z0-9-]', '', 'g'
              ),
              '-+', '-', 'g'
            ));
    IF base = '' THEN base := 'business'; END IF;
    candidate := base;
    n := 2;
    WHILE EXISTS (SELECT 1 FROM tenants WHERE slug = candidate) LOOP
      candidate := base || '-' || n;
      n := n + 1;
    END LOOP;
    UPDATE tenants SET slug = candidate WHERE id = t.id;
  END LOOP;
END $$;

ALTER TABLE tenants ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
