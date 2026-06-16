-- Migration: persist website-scan state on the agent, so the Business Identity
-- "Website" field can show a green "Connected" badge + last-scanned info.
-- Run in the Supabase SQL Editor.

ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS website_scanned_at TIMESTAMPTZ;
ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS website_scanned_url TEXT;
ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS website_kb_item_count INT;
