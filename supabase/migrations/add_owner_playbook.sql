-- Migration: Owner Playbook — the structured "owner's judgment" per AI employee.
-- The approved playbook is compiled into a managed block inside ai_employees.system_prompt,
-- so it reaches every customer channel (voice, SMS, email, social) with no runtime changes.
-- Run in the Supabase SQL Editor.

ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS playbook JSONB;                 -- structured OwnerPlaybook
ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS playbook_status TEXT DEFAULT 'none'
  CHECK (playbook_status IN ('none','draft','approved'));
ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS playbook_compiled TEXT;         -- rendered prompt block (also merged into system_prompt on approval)
ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS playbook_updated_at TIMESTAMPTZ;
ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS onboarding_answers JSONB;       -- owner-interview Q&A (input to generation)
