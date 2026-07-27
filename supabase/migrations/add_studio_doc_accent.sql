-- Migration: document accent colour for Studio docs.
-- Run in the Supabase SQL Editor AFTER add_studio_doc_branding.sql. Idempotent.
--
-- accent_color is a '#RRGGBB' hex (NULL = the default neutral/ink look). Like logo_url and terms it is
-- set once per tenant in studio_doc_settings and SNAPSHOT onto studio_documents at creation, so changing
-- the brand colour later never repaints an already-issued quote/invoice.

ALTER TABLE studio_doc_settings ADD COLUMN IF NOT EXISTS accent_color text;
ALTER TABLE studio_documents    ADD COLUMN IF NOT EXISTS accent_color text;
