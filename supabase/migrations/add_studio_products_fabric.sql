-- Migration: add fabric selection to the main product too (previously only sub-products had it).
-- Run in the Supabase SQL Editor AFTER add_studio_variants_rich.sql. Idempotent.

ALTER TABLE studio_products
  ADD COLUMN IF NOT EXISTS fabric_category    text,
  ADD COLUMN IF NOT EXISTS fabric_family      text,
  ADD COLUMN IF NOT EXISTS fabric_name        text,
  ADD COLUMN IF NOT EXISTS fabric_composition text,
  ADD COLUMN IF NOT EXISTS fabric_durability  text;
