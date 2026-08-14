-- Migration: one TTS vendor, so one voice vocabulary.
--
-- `ai_employees.voice` held two different things at once: Deepgram Aura model ids (what the phone
-- has used for a long time, and what the picker writes) and four ElevenLabs keys inherited from the
-- column's own DEFAULT. The sandbox route mapped those four keys to ElevenLabs voices and could not
-- recognise an Aura id at all, so an agent with a real voice was spoken by a hardcoded fallback.
--
-- ElevenLabs is gone. This rewrites the four legacy values to the nearest Aura voice, moves the
-- column default off the last one, and leaves the column holding exactly one kind of value — which is
-- why the code has no legacy branch to keep in sync.
--
-- Checked against production before writing: 25 agents, of which 2 still held 'professional_female'.
--
-- Run in the Supabase SQL Editor.

-- Matilda (Professional)        → Andromeda (Professional & clear)
UPDATE ai_employees SET voice = 'aura-2-andromeda-en' WHERE voice = 'professional_female';
-- Daniel (Steady Broadcaster)   → Odysseus  (Deep & professional)
UPDATE ai_employees SET voice = 'aura-2-odysseus-en'  WHERE voice = 'professional_male';
-- Jessica (Playful & Warm)      → Asteria   (Warm & friendly)
UPDATE ai_employees SET voice = 'aura-2-asteria-en'   WHERE voice = 'friendly_female';
-- Eric (Smooth & Trustworthy)   → Arcas     (Natural & smooth)
UPDATE ai_employees SET voice = 'aura-2-arcas-en'     WHERE voice = 'friendly_male';

-- Anything else that is not an Aura id — empty, null, a typo, a value from an old restore — becomes
-- the default rather than a 400 from the TTS endpoint. Same rule the code applies at call time.
UPDATE ai_employees
   SET voice = 'aura-2-asteria-en'
 WHERE voice IS NULL OR voice !~ '^aura-2?-[a-z]+-(en|es)$';

-- The source of the legacy values in the first place.
ALTER TABLE ai_employees ALTER COLUMN voice SET DEFAULT 'aura-2-asteria-en';
