-- Migration: post-onboarding success checklist state
-- Run this in Supabase SQL Editor for existing databases.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_checklist JSONB DEFAULT '{}'::jsonb;
