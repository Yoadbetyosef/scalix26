-- ============================================================================
-- Document letterhead — the printed bands a tenant's estimates, quotes and invoices go out on.
--
-- Everything the band prints already existed per tenant EXCEPT three things, and this migration adds
-- exactly those three, alongside the switch that turns the whole thing on:
--
--   letterhead_enabled  off by default, so no tenant inherits another's stationery on deploy.
--   letterhead_tagline  the footer line between the two diamonds ("CUSTOM RINGS & FINE JEWELLERY").
--   letterhead_email    the address the LETTERHEAD shows, which is not always the address the account
--                       is registered under — a shop signs its documents sales@, not the owner's inbox.
--                       Null falls back to tenants.email.
--   instagram_handle    the one contact channel the tenants table has never had a column for.
--
-- Website and phone are NOT here: tenants.website and tenants.phone already hold them, and a second
-- copy of a phone number is a second number to keep right.
--
-- These live on studio_doc_settings rather than tenants because that is already the per-tenant document
-- branding record — the logo and the accent colour the bands are drawn in are in the same row, edited
-- from the same screen.
--
-- Additive, idempotent. Safe to run more than once. The application reads these columns defensively,
-- so it renders today's unbranded document on a database where this has not been run yet.
-- ============================================================================

ALTER TABLE studio_doc_settings
  ADD COLUMN IF NOT EXISTS letterhead_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS letterhead_tagline text,
  ADD COLUMN IF NOT EXISTS letterhead_email   text,
  ADD COLUMN IF NOT EXISTS instagram_handle   text;

-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE studio_doc_settings
--   DROP COLUMN IF EXISTS letterhead_enabled,
--   DROP COLUMN IF EXISTS letterhead_tagline,
--   DROP COLUMN IF EXISTS letterhead_email,
--   DROP COLUMN IF EXISTS instagram_handle;
