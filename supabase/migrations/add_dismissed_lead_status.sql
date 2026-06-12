-- Migration: add 'dismissed' lead status (hidden from the active list).
-- Run this in the Supabase SQL Editor.

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check
  CHECK (status IN ('new','contacted','booked','called_back','dismissed'));
