-- Catalog products: add free-text Measurements (dimensions) and Fabric (material) fields.
-- Run in the Supabase SQL Editor. Idempotent.
ALTER TABLE catalog_products
  ADD COLUMN IF NOT EXISTS measurements text,
  ADD COLUMN IF NOT EXISTS fabric text;
