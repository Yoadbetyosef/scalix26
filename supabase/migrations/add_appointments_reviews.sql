-- Migration: Appointment booking + Google review automation.
-- Run this in the Supabase SQL Editor.
-- NOTE: the old `appointments` table (scheduled_at/notes/address) was empty and
-- unused by the app, so we replace it with the booking structure below.

DROP TABLE IF EXISTS appointments CASCADE;

CREATE TABLE appointment_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  slot_time TIME NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  slot_date DATE NOT NULL,
  slot_time TIME NOT NULL,
  customer_name TEXT,
  customer_phone TEXT NOT NULL,
  service_type TEXT,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed')),
  skip_review BOOLEAN DEFAULT false,
  review_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE appointment_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant slots access" ON appointment_slots;
DROP POLICY IF EXISTS "Tenant appointments access" ON appointments;
CREATE POLICY "Tenant slots access" ON appointment_slots FOR ALL USING (tenant_id = get_tenant_id());
CREATE POLICY "Tenant appointments access" ON appointments FOR ALL USING (tenant_id = get_tenant_id());

CREATE INDEX idx_appointments_date ON appointments(tenant_id, slot_date, slot_time);
CREATE INDEX idx_slots_day ON appointment_slots(tenant_id, day_of_week);
-- Used by the review cron to find appointments due for a review SMS.
CREATE INDEX idx_appointments_review ON appointments(review_sent_at, skip_review, created_at);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS google_review_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS review_automation_enabled BOOLEAN DEFAULT true;
