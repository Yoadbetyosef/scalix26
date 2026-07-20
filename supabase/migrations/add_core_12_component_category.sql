-- ============================================================================
-- Scalix Core — Component category (inherits the parent product's category by default)
-- ============================================================================
-- Additive & non-destructive. A component/sub-product can carry its own category (from the SAME tenant
-- category system as products) or inherit the parent product's category. use_parent_category defaults to
-- true so existing components keep showing the parent's category with no change. Run in a FRESH SQL tab.

ALTER TABLE product_components
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS use_parent_category boolean NOT NULL DEFAULT true;
