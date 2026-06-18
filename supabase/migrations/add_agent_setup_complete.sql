-- Migration: mark whether an agent's first-run setup was finished. New agents start
-- as drafts (setup_complete=false) until the owner clicks "Finish setup"; navigating
-- to "New Employee" reuses an existing unfinished draft instead of creating +
-- provisioning a second one. DEFAULT true so existing agents are treated as finished
-- (never reused as drafts). Run in the Supabase SQL Editor.

ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN DEFAULT true;
