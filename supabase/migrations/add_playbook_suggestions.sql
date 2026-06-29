-- Migration: Playbook suggestions — the continuous-learning review queue.
-- Amy analyzes past conversations / takeovers / outcomes and proposes rule/example
-- changes. Nothing changes the live AI until the owner approves a suggestion, which
-- merges it into the Owner Playbook and recompiles the prompt. Run in the SQL Editor.

CREATE TABLE IF NOT EXISTS playbook_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  section TEXT NOT NULL,                      -- which playbook section it targets
  observation TEXT NOT NULL,                  -- "what Amy noticed"
  evidence JSONB DEFAULT '{}',                -- { conversation_ids, message_ids, snippets }
  proposed JSONB NOT NULL,                    -- { text } or { customer, reply } to add
  channels TEXT[] DEFAULT '{}',               -- affected channels
  confidence NUMERIC DEFAULT 0.5,             -- 0..1
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_playbook_suggestions_scope
  ON playbook_suggestions (tenant_id, ai_employee_id, status);

ALTER TABLE playbook_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant playbook_suggestions access" ON playbook_suggestions;
CREATE POLICY "Tenant playbook_suggestions access" ON playbook_suggestions
  FOR ALL USING (tenant_id = get_tenant_id());
