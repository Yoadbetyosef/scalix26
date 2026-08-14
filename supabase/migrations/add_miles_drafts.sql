-- Migration: held drafts — the replies Miles wrote but will not send without a decision.
--
-- Modelled on payment_requests, which is the same idea for money: the AI produces something, an owner
-- decides, and until they do it does not happen. Same per-tenant/per-agent/per-conversation columns,
-- same pending → decided lifecycle, same RLS shape.
--
-- ONE DELIBERATE DIFFERENCE. payment_requests has an 'expired' status; this has none, and there is no
-- due-at column to build one from. A draft waits indefinitely: no timeout, no auto-send, no holding
-- message. Nothing goes out in the owner's name without an explicit decision, and a status that
-- expires is a decision made by a clock.
--
-- Run in the Supabase SQL Editor.

-- 1) The queue.
CREATE TABLE IF NOT EXISTS held_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  channel TEXT,                                   -- sms | instagram | facebook | email
  -- What it answers, so a draft can never be shown next to the wrong question.
  inbound_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  inbound_excerpt TEXT,                           -- the customer's words, for the notification body
  -- The draft, verbatim, exactly as it would send. The notification carries THIS — never
  -- "you have a draft, open the app".
  body TEXT NOT NULL,
  -- What actually went out, when it differs from `body` because the owner edited it. Null while
  -- pending and when sent unchanged.
  sent_body TEXT,
  -- Why it was held: [{ kind, evidence }] from lib/miles/autonomy.ts. Plural because a reply can
  -- commit you to more than one thing at once.
  reasons JSONB NOT NULL DEFAULT '[]',
  -- pending  — waiting on a person, for as long as that takes
  -- sent     — the owner sent it, as drafted or edited
  -- handled  — "I'll handle it": Miles stops replying on that thread (conversations.human_takeover)
  -- replaced — a newer inbound arrived and Miles drafted again; kept so the history is not rewritten
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'handled', 'replaced')),
  created_by TEXT NOT NULL DEFAULT 'ai',          -- ai | owner
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  decided_by TEXT,                                -- user id, or 'sms'/'email' when decided from a link
  -- The assistant message the send produced, so a row can point at what it became.
  sent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL
);

-- The inbox reads pending-first, newest-first, per tenant.
CREATE INDEX IF NOT EXISTS held_drafts_tenant_idx ON held_drafts (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS held_drafts_agent_idx ON held_drafts (ai_employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS held_drafts_conversation_idx ON held_drafts (conversation_id, created_at DESC);

-- AT MOST ONE PENDING DRAFT PER CONVERSATION. A second inbound message on a thread that already has a
-- draft waiting means the first draft answers a stale question; approving it would send the owner's
-- name against the wrong message. The writer marks the old one 'replaced' rather than editing it, so
-- what was held and never sent stays visible.
CREATE UNIQUE INDEX IF NOT EXISTS held_drafts_one_pending_per_conversation
  ON held_drafts (conversation_id) WHERE status = 'pending';

ALTER TABLE held_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant held_drafts access" ON held_drafts;
CREATE POLICY "Tenant held_drafts access" ON held_drafts FOR ALL USING (tenant_id = get_tenant_id());

-- 2) The autonomy rules the owner sets BY TELLING MILES, not by filling in a form.
--
-- Per agent, because it is that employee's brief. Shape is
--   [{ id, kind, action, phrase, created_at }]
-- where kind is a commitment kind from lib/miles/autonomy.ts and action is 'hold' | 'send'. `phrase`
-- keeps what the owner actually said, so the rule can be read back to them in their own words rather
-- than as a settings row they never wrote.
ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS autonomy_rules JSONB NOT NULL DEFAULT '[]';
