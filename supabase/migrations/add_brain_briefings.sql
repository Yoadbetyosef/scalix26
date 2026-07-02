-- Migration: brain_briefings — caches the COO's spoken morning briefing so we NEVER pay for
-- TTS on repeat plays. One row per agent; version_key = hash of the briefing text. Audio is
-- regenerated only when the text changes (i.e. when the Brain's understanding changes).

CREATE TABLE IF NOT EXISTS brain_briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  version_key TEXT NOT NULL,     -- sha256 of the briefing text
  text TEXT NOT NULL,
  audio_base64 TEXT,             -- cached ElevenLabs mp3; null => client uses speechSynthesis
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ai_employee_id)
);

ALTER TABLE brain_briefings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant brain_briefings access" ON brain_briefings;
CREATE POLICY "Tenant brain_briefings access" ON brain_briefings FOR ALL USING (tenant_id = get_tenant_id());
