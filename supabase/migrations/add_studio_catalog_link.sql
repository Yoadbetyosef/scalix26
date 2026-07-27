-- Migration: link a Studio product to its Catalog (inventory) product, so a catalog product
-- auto-gains the Studio experience (fabric, sub-products, actions) and stays one product.
-- Run in the Supabase SQL Editor AFTER the other studio migrations. Idempotent.
--
-- Adding a product in the Catalog auto-creates its Studio counterpart (server-side), linked here.
-- ON DELETE CASCADE: deleting the catalog product removes its studio row (and its variants/docs).

ALTER TABLE studio_products
  ADD COLUMN IF NOT EXISTS catalog_product_id uuid UNIQUE REFERENCES catalog_products(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_studio_products_catalog ON studio_products(catalog_product_id);
