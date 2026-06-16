-- Migration: per-agent voice language for the Deepgram Voice Agent (voice calls).
-- 'en' = English (default — existing agents unaffected), 'es' = Spanish,
-- 'bilingual' = code-switch EN<->ES. Text channels already reply in the caller's
-- language via Claude; this only drives the voice (STT/TTS/voice-prompt) path.
-- Run in the Supabase SQL Editor.

ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS voice_language TEXT DEFAULT 'en';
