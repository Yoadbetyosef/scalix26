-- Scalix26 Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TENANTS
-- ============================================================
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  industry TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  business_hours JSONB DEFAULT '{"mon":"9:00-17:00","tue":"9:00-17:00","wed":"9:00-17:00","thu":"9:00-17:00","fri":"9:00-17:00","sat":"closed","sun":"closed"}',
  timezone TEXT DEFAULT 'America/New_York',
  plan TEXT DEFAULT 'trial' CHECK (plan IN ('trial','starter','pro','business')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  trial_ends_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days',
  lead_intake_token UUID DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-generate a unique, human-readable slug from business_name on insert
CREATE OR REPLACE FUNCTION set_tenant_slug() RETURNS trigger AS $$
DECLARE
  base TEXT;
  candidate TEXT;
  n INT := 2;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
    RETURN NEW;
  END IF;
  base := trim(both '-' from regexp_replace(
            regexp_replace(
              regexp_replace(lower(coalesce(NEW.business_name, 'business')), '\s+', '-', 'g'),
              '[^a-z0-9-]', '', 'g'
            ),
            '-+', '-', 'g'
          ));
  IF base = '' THEN base := 'business'; END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM tenants WHERE slug = candidate) LOOP
    candidate := base || '-' || n;
    n := n + 1;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_tenant_slug ON tenants;
CREATE TRIGGER trg_set_tenant_slug BEFORE INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_tenant_slug();

-- ============================================================
-- AI EMPLOYEES
-- ============================================================
CREATE TABLE ai_employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Alex',
  avatar_url TEXT DEFAULT '/avatars/avatar-1.png',
  voice TEXT DEFAULT 'professional_female',
  greeting TEXT DEFAULT 'Hi! Thank you for contacting us. How can I help you today?',
  personality TEXT DEFAULT 'friendly',
  personality_score INTEGER DEFAULT 70 CHECK (personality_score BETWEEN 0 AND 100),
  system_prompt TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('active','draft')),
  -- Per-agent business identity
  business_name TEXT,
  industry TEXT,
  website TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  business_hours JSONB DEFAULT '{"mon":"9:00-17:00","tue":"9:00-17:00","wed":"9:00-17:00","thu":"9:00-17:00","fri":"9:00-17:00","sat":"closed","sun":"closed"}',
  timezone TEXT DEFAULT 'America/New_York',
  forward_to_phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CHANNELS
-- ============================================================
CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sms','whatsapp','voice','instagram','facebook')),
  credentials JSONB DEFAULT '{}',
  status TEXT DEFAULT 'disconnected' CHECK (status IN ('connected','disconnected','pending')),
  twilio_number TEXT,
  meta_page_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CONTACTS
-- ============================================================
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  channel TEXT,
  language TEXT DEFAULT 'en',
  last_interaction TIMESTAMPTZ,
  total_conversations INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','resolved','closed')),
  human_takeover BOOLEAN DEFAULT false,
  summary TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive','neutral','negative')),
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','agent')),
  content TEXT NOT NULL,
  channel TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SKILLS
-- ============================================================
CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'appointment_booking',
    'lead_qualification',
    'faq_answering',
    'review_request',
    'emergency_routing',
    'estimate_request',
    'appointment_reminders',
    'bilingual_autodetect'
  )),
  config JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- KNOWLEDGE BASE
-- ============================================================
CREATE TABLE knowledge_base (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  ai_employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual','website','document','template')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- APPOINTMENTS
-- ============================================================
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  service_type TEXT,
  scheduled_at TIMESTAMPTZ,
  address TEXT,
  notes TEXT,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','completed','cancelled','no_show')),
  reminder_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- LEADS (Speed to Lead)
-- ============================================================
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('missed_call','web_form','google_lsa','facebook','yelp','angi','other')),
  phone TEXT NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new','contacted','booked','lost')),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ANALYTICS EVENTS
-- ============================================================
CREATE TABLE analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Tenants: user can only see their own tenant
CREATE POLICY "Users can view own tenant" ON tenants FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can update own tenant" ON tenants FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can insert own tenant" ON tenants FOR INSERT WITH CHECK (user_id = auth.uid());

-- Helper function to get current user's tenant_id
CREATE OR REPLACE FUNCTION get_tenant_id()
RETURNS UUID AS $$
  SELECT id FROM tenants WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER;

-- AI Employees: tenant-scoped
CREATE POLICY "Tenant ai_employees access" ON ai_employees FOR ALL USING (tenant_id = get_tenant_id());

-- Channels
CREATE POLICY "Tenant channels access" ON channels FOR ALL USING (tenant_id = get_tenant_id());

-- Contacts
CREATE POLICY "Tenant contacts access" ON contacts FOR ALL USING (tenant_id = get_tenant_id());

-- Conversations
CREATE POLICY "Tenant conversations access" ON conversations FOR ALL USING (tenant_id = get_tenant_id());

-- Messages
CREATE POLICY "Tenant messages access" ON messages FOR ALL USING (tenant_id = get_tenant_id());

-- Skills
CREATE POLICY "Tenant skills access" ON skills FOR ALL USING (tenant_id = get_tenant_id());

-- Knowledge Base
CREATE POLICY "Tenant knowledge_base access" ON knowledge_base FOR ALL USING (tenant_id = get_tenant_id());

-- Appointments
CREATE POLICY "Tenant appointments access" ON appointments FOR ALL USING (tenant_id = get_tenant_id());

-- Analytics Events
CREATE POLICY "Tenant analytics_events access" ON analytics_events FOR ALL USING (tenant_id = get_tenant_id());

-- Leads
CREATE POLICY "Tenant leads access" ON leads FOR ALL USING (tenant_id = get_tenant_id());

-- Webhook bypass (for service role)
-- Use service role key in webhook routes to bypass RLS

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_tenants_user_id ON tenants(user_id);
CREATE UNIQUE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_ai_employees_tenant_id ON ai_employees(tenant_id);
CREATE INDEX idx_channels_tenant_id ON channels(tenant_id);
CREATE INDEX idx_channels_ai_employee_id ON channels(ai_employee_id);
CREATE INDEX idx_channels_twilio_number ON channels(twilio_number);
CREATE INDEX idx_channels_meta_page_id ON channels(meta_page_id);
CREATE INDEX idx_contacts_tenant_id ON contacts(tenant_id);
CREATE INDEX idx_contacts_phone ON contacts(phone);
CREATE INDEX idx_conversations_tenant_id ON conversations(tenant_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_skills_ai_employee_id ON skills(ai_employee_id);
CREATE INDEX idx_knowledge_base_tenant_id ON knowledge_base(tenant_id);
CREATE INDEX idx_appointments_tenant_id ON appointments(tenant_id);
CREATE INDEX idx_appointments_scheduled_at ON appointments(scheduled_at);
CREATE INDEX idx_analytics_events_tenant_id ON analytics_events(tenant_id);
CREATE INDEX idx_analytics_events_event_type ON analytics_events(event_type);
CREATE INDEX idx_leads_tenant_id ON leads(tenant_id);
CREATE INDEX idx_leads_created_at ON leads(created_at);
CREATE INDEX idx_leads_phone ON leads(phone);
