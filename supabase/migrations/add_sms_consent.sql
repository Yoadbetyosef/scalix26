-- SMS opt-in consent proof (A2P 10DLC / TCPA). Captured on the signup form when the user checks the
-- SMS consent box next to their mobile number. Best-effort write in app/api/auth/signup/route.ts —
-- signup keeps working before this runs; consent starts persisting once it's applied.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ;
