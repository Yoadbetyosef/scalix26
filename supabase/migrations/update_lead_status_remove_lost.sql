-- Migration: drop the 'lost' lead status, allow 'called_back'.
-- Statuses are now: new (untouched) → contacted (AI spoke) → booked (job won).
-- Run this in the Supabase SQL Editor.
-- NOTE: fails if any row still has status='lost' — update those first, e.g.
--   UPDATE leads SET status='contacted' WHERE status='lost';

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check
  CHECK (status IN ('new','contacted','booked','called_back'));
