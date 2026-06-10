-- Migration: Human Takeover for conversations
-- Run this in Supabase SQL Editor for existing databases

-- Per-conversation flag: when true, the AI stops responding and a human handles it
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS human_takeover BOOLEAN DEFAULT false;

-- Allow manually-sent agent messages in the transcript
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;
ALTER TABLE messages ADD CONSTRAINT messages_role_check
  CHECK (role IN ('user','assistant','system','agent'));
