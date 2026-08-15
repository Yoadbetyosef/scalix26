-- ============================================================================
-- WHERE AN APPOINTMENT HAPPENS, AND HOW LONG IT TAKES.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- ── THE CONCEPT ALREADY ARRIVED. IT HAD NOWHERE TO LAND ────────────────────
--
-- One of the three appointments in the database reads:
--
--     2026-06-23 11:00   Joe   service_type = 'Google Meet'   completed
--
-- Somebody said "Google Meet" on a call and it went into the free-text service
-- field, because that was the only column that would take a string. The table
-- has fifteen columns and not one of them says where the appointment happens.
--
-- `channel` does NOT say it and never did: it records how the booking was TAKEN
-- (voice / sms / email), so a job booked over the phone that you drive to and a
-- video call booked over the phone are both 'voice'.
--
-- ── NOTHING HERE IS INFERRED FROM service_type ─────────────────────────────
--
-- Deliberately. Matching "zoom" or "meet" in free text is how a toilet repair
-- somebody called "Google Meet" gets a violet spine and a Join button that goes
-- nowhere. The kind is set by the booking tool from what the customer actually
-- agreed to, or it stays 'on_site', which is the truthful default for a trades
-- business and the behaviour every existing row already has.
--
-- ── ADDRESS BELONGS TO THE JOB, NOT THE PERSON ─────────────────────────────
--
-- `contacts.address` exists and is empty on every live row. It is also the wrong
-- place: the same customer can have two properties, and where THIS job is does
-- not change when they move house. So the address is on the appointment.
--
-- This is the column the live 11:00 booking has been waiting for — the AI asked
-- for an address twice and had nowhere to put the answer.
--
-- ── NO CHECK TIES A KIND TO ITS DETAIL, ON PURPOSE ─────────────────────────
--
-- An on-site job with no address, or a Zoom with no link, is a REAL state — it
-- is the amber "missing something" row on the agenda, and the screen exists to
-- surface it. A constraint forbidding it would push the failure into the booking
-- path, where it would mean losing the appointment rather than flagging it.
-- ============================================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS meeting_kind     text NOT NULL DEFAULT 'on_site',
  ADD COLUMN IF NOT EXISTS join_url         text,
  ADD COLUMN IF NOT EXISTS address          text,
  ADD COLUMN IF NOT EXISTS duration_minutes integer;

-- The four the agenda draws. Written as a named constraint so it can be replaced
-- when a fifth arrives, the same shape as leads_status_check.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_meeting_kind_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_meeting_kind_check
  CHECK (meeting_kind IN ('on_site', 'zoom', 'google_meet', 'phone'));

-- A sane length must not be a per-appointment guess by the model. The AI sets
-- duration_minutes only when the customer actually agreed to a length; otherwise
-- the row is null and the screen falls back to this.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS default_appointment_minutes integer NOT NULL DEFAULT 60;

COMMENT ON COLUMN appointments.meeting_kind IS
  'Where it happens: on_site | zoom | google_meet | phone. Set by the booking tool from what was agreed — NEVER inferred from service_type. Drives the agenda spine colour and the primary action.';
COMMENT ON COLUMN appointments.join_url IS
  'The link for a zoom/google_meet appointment. Null on a video appointment is the "missing something" state the agenda flags in amber, not an error.';
COMMENT ON COLUMN appointments.address IS
  'Where THIS job is. Not contacts.address — the same customer can have two properties, and the job address does not change when they move.';
COMMENT ON COLUMN appointments.duration_minutes IS
  'Agreed length. Null means nobody agreed one; the screen falls back to tenants.default_appointment_minutes.';
COMMENT ON COLUMN tenants.default_appointment_minutes IS
  'How long an appointment runs when nothing more specific was agreed. Gives the agenda time-rail a source instead of a guess.';

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect: four rows on appointments, one on tenants, and the constraint.

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE (table_name = 'appointments' AND column_name IN ('meeting_kind', 'join_url', 'address', 'duration_minutes'))
   OR (table_name = 'tenants' AND column_name = 'default_appointment_minutes')
ORDER BY table_name, column_name;

SELECT conname FROM pg_constraint WHERE conname = 'appointments_meeting_kind_check';

-- Expect every existing row to read on_site — the truthful default, and exactly
-- what they have always meant.
SELECT meeting_kind, count(*) FROM appointments GROUP BY meeting_kind;
