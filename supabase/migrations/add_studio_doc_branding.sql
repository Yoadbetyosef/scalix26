-- Migration: document branding (logo + terms + validity) and send/preview support for Studio docs.
-- Run in the Supabase SQL Editor AFTER add_studio_documents.sql. Idempotent.
--
-- studio_doc_settings: one row per tenant — the logo, default terms and validity applied to every new
-- quote/invoice/production doc (set once, editable anytime). Documents snapshot logo_url/terms/valid_until
-- at creation so a later settings change never alters an already-issued document. client_phone + sent_*
-- track SMS/email delivery.

CREATE TABLE IF NOT EXISTS studio_doc_settings (
  tenant_id     uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  logo_url      text,
  terms         text,
  validity_days integer NOT NULL DEFAULT 30,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE studio_doc_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE studio_documents
  ADD COLUMN IF NOT EXISTS logo_url     text,
  ADD COLUMN IF NOT EXISTS terms        text,
  ADD COLUMN IF NOT EXISTS valid_until  date,
  ADD COLUMN IF NOT EXISTS client_phone text,
  ADD COLUMN IF NOT EXISTS sent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS sent_channel text;
