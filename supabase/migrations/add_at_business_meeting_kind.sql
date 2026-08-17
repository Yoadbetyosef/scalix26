-- ============================================================================
-- A FIFTH MEETING KIND: at_business -- the customer comes to US.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- VERSION 2. The first attempt failed and nothing applied. I do not know why --
-- if it fails again, PASTE THE ERROR, because everything below is ordinary DDL
-- and I am not going to keep guessing at it.
--
-- What changed to make this diagnosable:
--   * FIVE NUMBERED PARTS. Run them one at a time. Whichever one errors is the
--     answer, and the parts before it stay applied because each is independent.
--   * No semicolons inside any string literal. A naive editor that splits on
--     a semicolon would have cut the old COMMENT text in half, and that is
--     the only thing in the original I can see a paste path disliking.
--   * No apostrophes inside comment prose -- harmless to Postgres, but not to
--     every paste path, and this file should follow its own rule.
--   * Verification is PART 5, separate, so a SELECT can never roll back DDL.
--
-- ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
--
-- meeting_kind had four values and none carried DIRECTION. on_site means "in
-- person, somewhere physical" and says nothing about who travels, so three
-- places assumed the customer premises: the tool asked for a street address,
-- the column defaulted to it, and the agenda flagged an on_site row with no
-- address as amber forever. One gap, three symptoms.
--
-- The default has THREE states and that is the point:
--   on_site      we travel
--   at_business  they come to us
--   NULL         unknown, so Rudi ASKS once and writes the answer back
-- NULL meaning ask rather than assume travel is the entire bug.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- PART 1 of 5 -- the fifth kind. Run this alone first.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_meeting_kind_check;

ALTER TABLE appointments ADD CONSTRAINT appointments_meeting_kind_check
  CHECK (meeting_kind IN ('on_site', 'at_business', 'zoom', 'google_meet', 'phone'));


-- ════════════════════════════════════════════════════════════════════════════
-- PART 2 of 5 -- the per-tenant default. Nullable ON PURPOSE: NULL is a third
-- state meaning ask, and the code must be able to tell it from an explicit
-- on_site.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_meeting_kind text;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_default_meeting_kind_check;

ALTER TABLE tenants ADD CONSTRAINT tenants_default_meeting_kind_check
  CHECK (default_meeting_kind IS NULL OR default_meeting_kind IN ('on_site', 'at_business'));


-- ════════════════════════════════════════════════════════════════════════════
-- PART 3 of 5 -- the four that are known, seeded BY ID.
--
-- Not by keyword. A LIKE on jewel would catch the first three and miss the
-- fourth, and the fourth is the point: Smith Hvac reads industry HVAC and is
-- being used as a jeweller, so the override is written down rather than being
-- quietly right for the wrong reason.
--
-- Everything else stays NULL. Twelve travelling trades derive from industry and
-- need no row; the remaining seventeen get the question.
-- ════════════════════════════════════════════════════════════════════════════

UPDATE tenants SET default_meeting_kind = 'at_business'
WHERE id IN (
  'e6f07ad7-c5a2-4997-b798-cca7e09e837f',
  '8041c0b5-c960-48bd-a3f7-655f5a0b6434',
  '30e9ad1d-3df2-4c05-80d9-f6a22ac37fa5',
  'fea1d3c6-93c6-4a7f-8c31-2511286789d5'
);


-- ════════════════════════════════════════════════════════════════════════════
-- PART 4 of 5 -- Joel. 18 Aug 11:00, Smith Hvac, service "Engagement rings",
-- no address, coming to the shop.
--
-- Scoped to the one row by tenant, date, name AND its current shape, so if an
-- address has been set on it since this was written the clause matches nothing
-- and the row is left alone rather than overwritten.
--
-- REQUIRES PART 1. On its own it fails with 23514.
-- ════════════════════════════════════════════════════════════════════════════

UPDATE appointments SET meeting_kind = 'at_business'
WHERE tenant_id = 'fea1d3c6-93c6-4a7f-8c31-2511286789d5'
  AND slot_date = '2026-08-18'
  AND customer_name = 'Joel'
  AND address IS NULL
  AND meeting_kind = 'on_site';


-- ════════════════════════════════════════════════════════════════════════════
-- PART 5 of 5 -- verify. Read-only. Run last, or any time.
-- ════════════════════════════════════════════════════════════════════════════

-- Expect five kinds including at_business.
SELECT pg_get_constraintdef(oid) AS meeting_kind_check
FROM pg_constraint WHERE conname = 'appointments_meeting_kind_check';

-- Expect on_site and at_business only.
SELECT pg_get_constraintdef(oid) AS tenant_default_check
FROM pg_constraint WHERE conname = 'tenants_default_meeting_kind_check';

-- Expect exactly 4, and the fourth to be Smith Hvac with industry HVAC --
-- the visible exception.
SELECT business_name, industry, default_meeting_kind
FROM tenants WHERE default_meeting_kind IS NOT NULL ORDER BY business_name;

-- Expect 29.
SELECT count(*) AS tenants_still_unknown FROM tenants WHERE default_meeting_kind IS NULL;

-- Expect Joel at at_business, address still null, and none needed.
SELECT slot_date, slot_time, customer_name, service_type, meeting_kind, address
FROM appointments
WHERE tenant_id = 'fea1d3c6-93c6-4a7f-8c31-2511286789d5' ORDER BY slot_date;

-- Expect 0 -- no other appointment was touched.
SELECT count(*) AS other_appts_at_business
FROM appointments
WHERE meeting_kind = 'at_business' AND customer_name <> 'Joel';


-- ============================================================================
-- The COMMENT statements are deliberately LAST and separate. They are
-- documentation, they are the only statements here that need table ownership,
-- and if they are what fails then everything above is already applied and only
-- these need dropping.
-- ============================================================================

COMMENT ON COLUMN appointments.meeting_kind IS
  'Where it happens AND who travels. on_site = we go to them, an address is expected. at_business = they come to us, the tenant own address is shown and nothing is asked. zoom/google_meet = a link. phone = a call.';

COMMENT ON COLUMN tenants.default_meeting_kind IS
  'What an in-person booking means for THIS business. NULL = unknown, and Rudi asks once on the first in-person booking rather than assuming travel. Assuming was the bug.';
