-- Migration: Payment Collection skill — lets the AI create/send secure Stripe payment
-- links via the tenant's connected Stripe account (money goes directly to the tenant).
-- Adds the skill type, per-agent settings, and an owner-approval queue. Run in the SQL
-- editor. Does not touch platform billing.

-- 1) Allow the new skill type (the skills.type column has a CHECK constraint).
ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_type_check;
ALTER TABLE skills ADD CONSTRAINT skills_type_check CHECK (type IN (
  'appointment_booking','lead_qualification','faq_answering','review_request',
  'emergency_routing','estimate_request','appointment_reminders','payment_collection'
));

-- 2) Per-agent Payment Collection settings.
ALTER TABLE ai_employees ADD COLUMN IF NOT EXISTS payment_collection_settings JSONB;

-- 3) Owner-approval queue. A pending row is created when approval is required; approving it
-- creates the Stripe Checkout Session on the connected account.
CREATE TABLE IF NOT EXISTS payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  conversation_id TEXT,
  contact_id TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  channel TEXT,                                  -- sms | email | whatsapp | …
  kind TEXT NOT NULL DEFAULT 'product',          -- product | custom | deposit
  price_id TEXT,
  product_name TEXT,
  amount INTEGER,                                -- minor units (cents), for custom/deposit
  currency TEXT DEFAULT 'usd',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',        -- pending | sent | rejected | expired
  payment_id UUID,
  checkout_url TEXT,
  checkout_session_id TEXT,
  created_by TEXT NOT NULL DEFAULT 'ai',         -- ai | owner
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS payment_requests_tenant_idx ON payment_requests (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_requests_agent_idx ON payment_requests (ai_employee_id, created_at DESC);

ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant payment_requests access" ON payment_requests;
CREATE POLICY "Tenant payment_requests access" ON payment_requests FOR ALL USING (tenant_id = get_tenant_id());
