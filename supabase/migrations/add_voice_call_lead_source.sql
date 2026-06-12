-- Migration: allow 'voice_call' as a lead source.
-- The leads.source CHECK constraint did not include 'voice_call', so leads
-- captured by the AI on a voice call failed to insert (Postgres error 23514)
-- and never reached the dashboard / realtime toast.
-- Run this in the Supabase SQL Editor.

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check
  CHECK (source IN ('missed_call','voice_call','web_form','google_lsa','facebook','yelp','angi','other'));
