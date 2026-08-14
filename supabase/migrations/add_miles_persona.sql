-- Migration: which persona an AI employee wears.
--
-- Miles is a second ai_employees row, not a role — he owns inbound messages while Rudi keeps the
-- phone. The row needs one field saying WHICH employee it is so the persona map (lib/persona) can be
-- read for it: name, voice, portrait, ground, accent.
--
-- DEFAULT 'rudi' because every agent that existed before this column was a phone agent, and the
-- default has to be the thing that is already true. Extra phone employees created from
-- /api/agents/create stay 'rudi' too — persona is which identity the engine paints, not how many
-- employees a tenant has.
--
-- Run in the Supabase SQL Editor.

ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS persona TEXT NOT NULL DEFAULT 'rudi';

ALTER TABLE ai_employees DROP CONSTRAINT IF EXISTS ai_employees_persona_check;
ALTER TABLE ai_employees ADD CONSTRAINT ai_employees_persona_check CHECK (persona IN ('rudi', 'miles'));

-- At most ONE Miles per tenant. A tenant may hold several phone employees (the plan decides how
-- many), but "the employee who owns inbound messages" is singular by definition — two of them would
-- mean two agents racing to answer the same Instagram DM. Partial index: only 'miles' is constrained.
CREATE UNIQUE INDEX IF NOT EXISTS ai_employees_one_miles_per_tenant
  ON ai_employees (tenant_id) WHERE persona = 'miles';
