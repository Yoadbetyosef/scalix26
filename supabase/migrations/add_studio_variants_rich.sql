-- Migration: enrich studio_variants into full "sub-products" + fabric selection.
-- Run in the Supabase SQL Editor AFTER add_studio_catalog.sql. Idempotent.
--
-- A sub-product now carries the same rich fields a product has (its own name, description, photos)
-- PLUS a chosen fabric (category → family → colour, with composition + durability) from the fabric
-- library. Existing columns kept: label, attributes, sku, price, position, qr_token.

ALTER TABLE studio_variants
  ADD COLUMN IF NOT EXISTS name               text,
  ADD COLUMN IF NOT EXISTS description        text,
  ADD COLUMN IF NOT EXISTS photos             text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fabric_category    text,
  ADD COLUMN IF NOT EXISTS fabric_family      text,
  ADD COLUMN IF NOT EXISTS fabric_name        text,   -- specific fabric/colour full name
  ADD COLUMN IF NOT EXISTS fabric_composition text,
  ADD COLUMN IF NOT EXISTS fabric_durability  text;
