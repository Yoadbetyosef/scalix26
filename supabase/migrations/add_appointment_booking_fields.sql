-- Layer 1 appointment booking: make confirmed bookings first-class + race-safe.
-- Run in the Supabase SQL Editor. Appointments are scoped per-TENANT (matching
-- appointment_slots, which has no ai_employee_id), so uniqueness is per tenant+slot.

-- Capture the customer's email (when given) and the channel the booking came from.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS channel TEXT;  -- 'voice' | 'sms' | 'email'

-- No double-booking, race-safe: at most one ACTIVE booking per tenant + slot
-- datetime. Partial (excludes cancelled) so a freed time can be rebooked. A
-- concurrent second INSERT raises 23505 → the API returns "that time was just
-- taken" instead of confirming two customers into the same slot.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_appt_active_slot
  ON appointments (tenant_id, slot_date, slot_time)
  WHERE status <> 'cancelled';
