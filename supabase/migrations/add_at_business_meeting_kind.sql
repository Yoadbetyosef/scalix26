-- ============================================================================
-- A FIFTH MEETING KIND: at_business — the customer comes to US.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- `meeting_kind` had four values and none of them carried DIRECTION. `on_site`
-- means "in person, somewhere physical" and says nothing about who travels — so
-- three separate places assumed the customer's premises:
--
--   the tool     "Street address for an on_site job" → Rudi asks a jeweller's
--                customer where they live.
--   the default  meeting_kind DEFAULT 'on_site', and the tool's own "default
--                on_site when it was not discussed".
--   the agenda   an on_site row with no address goes amber, permanently.
--
-- One gap, three symptoms. A ring fitting is booked, the caller is asked for a
-- home address, and the row afterwards claims something is missing when nothing
-- was.
--
-- ── WHY A KIND AND NOT A TENANT FLAG ───────────────────────────────────────
--
-- Because it is a fact about THIS APPOINTMENT. A jeweller does home valuations;
-- an HVAC firm takes shop drop-offs. A per-tenant "we travel / they come to us"
-- would be right on average and wrong exactly when it matters.
--
-- ── AND WHY A DEFAULT IS STILL NEEDED ──────────────────────────────────────
--
-- The kind gives Rudi a way to SAY it. It does not tell her when to pick it —
-- the tool still defaults to on_site, so a jeweller would keep being asked. The
-- default is what closes that, and it deliberately has THREE states:
--
--   'on_site'      we travel. Derived silently when `industry` is one of the
--                  nine travelling trades, or set by hand.
--   'at_business'  they come to us.
--   NULL           WE DO NOT KNOW, and Rudi asks once — "will you be coming to
--                  us, or shall we come to you?" — then the answer is written
--                  here and never asked again.
--
-- NULL meaning "ask" rather than "assume travel" is the entire bug. `industry`
-- cannot supply it: its ten options are all travelling trades, and every
-- business with this problem sits in 'Other' (13 tenants) or NULL (8). The one
-- appointment that surfaced this — an engagement-ring consultation — is on a
-- tenant whose industry reads 'HVAC'. The column is decisive there and wrong.
-- ============================================================================

-- ── 1. The fifth kind ──────────────────────────────────────────────────────
-- add_appointment_meeting_kind.sql predicted this: "when a fifth arrives, the
-- same shape as leads_status_check."

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_meeting_kind_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_meeting_kind_check
  CHECK (meeting_kind IN ('on_site', 'at_business', 'zoom', 'google_meet', 'phone'));

COMMENT ON COLUMN appointments.meeting_kind IS
  'Where it happens AND who travels. on_site = we go to them (address expected). at_business = they come to us (the tenant''s own address is shown; nothing is asked). zoom/google_meet = a link. phone = a call. Default on_site, which is the pre-existing column default and true of every row booked before this existed.';

-- ── 2. The per-tenant default ──────────────────────────────────────────────
-- Nullable ON PURPOSE. NULL is not "unset pending a sensible guess" — it is a
-- third state that means ASK, and the code depends on being able to tell it
-- apart from an explicit 'on_site'.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS default_meeting_kind text;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_default_meeting_kind_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_default_meeting_kind_check
  CHECK (default_meeting_kind IS NULL OR default_meeting_kind IN ('on_site', 'at_business'));

COMMENT ON COLUMN tenants.default_meeting_kind IS
  'What an in-person booking means for THIS business. NULL = unknown, and Rudi asks once on the first in-person booking rather than assuming travel — assuming was the bug. Only on_site/at_business: a video or phone default would be a claim about the service, not about premises.';

-- ── 3. The four that are known ─────────────────────────────────────────────
--
-- Seeded by ID rather than by name or keyword. A LIKE '%jewel%' would catch
-- these three and miss the fourth, and the fourth is the point: Smith Hvac
-- reads industry 'HVAC' and is being used as a jeweller. Deriving it would be
-- quietly right for the wrong reason; this makes the exception visible.
--
-- Everything else stays NULL. The twelve travelling trades derive correctly
-- from `industry` and need no row here; the remaining seventeen get the
-- question, which is the design.

UPDATE tenants SET default_meeting_kind = 'at_business'
WHERE id IN (
  'e6f07ad7-c5a2-4997-b798-cca7e09e837f',  -- TG jewellers
  '8041c0b5-c960-48bd-a3f7-655f5a0b6434',  -- your design collective
  '30e9ad1d-3df2-4c05-80d9-f6a22ac37fa5',  -- reneisance jewelers  (dan@naturesparkle.com)
  'fea1d3c6-93c6-4a7f-8c31-2511286789d5'   -- Smith Hvac — EXPLICIT OVERRIDE, see above
);

-- ── 4. Joel ────────────────────────────────────────────────────────────────
--
-- 2026-08-18 11:00, Smith Hvac, service "Engagement rings", address NULL,
-- meeting_kind 'on_site' — so the agenda calls it missing an address it was
-- never going to have. He is coming to the shop.
--
-- Scoped to the one row by id AND tenant, and only while it still looks the way
-- it did when this was written: if somebody has since set an address on it, the
-- WHERE clause finds nothing and the row is left alone rather than overwritten.

UPDATE appointments
SET meeting_kind = 'at_business'
WHERE tenant_id = 'fea1d3c6-93c6-4a7f-8c31-2511286789d5'
  AND slot_date = '2026-08-18'
  AND customer_name = 'Joel'
  AND address IS NULL
  AND meeting_kind = 'on_site';

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect five kinds in the constraint, including at_business.

SELECT pg_get_constraintdef(oid) AS meeting_kind_check
FROM pg_constraint WHERE conname = 'appointments_meeting_kind_check';

SELECT pg_get_constraintdef(oid) AS tenant_default_check
FROM pg_constraint WHERE conname = 'tenants_default_meeting_kind_check';

-- Expect exactly 4 rows, all at_business, and the fourth to be Smith Hvac with
-- industry 'HVAC' — the visible exception.
SELECT business_name, industry, default_meeting_kind
FROM tenants WHERE default_meeting_kind IS NOT NULL ORDER BY business_name;

-- Expect 29 — the twelve that derive and the seventeen that get the question.
SELECT count(*) AS tenants_still_unknown FROM tenants WHERE default_meeting_kind IS NULL;

-- Expect ONE row: Joel, now at_business, still no address, and none needed.
SELECT slot_date, slot_time, customer_name, service_type, meeting_kind, address
FROM appointments
WHERE tenant_id = 'fea1d3c6-93c6-4a7f-8c31-2511286789d5' ORDER BY slot_date;

-- Expect 0: no other appointment was touched.
SELECT count(*) AS other_appts_at_business
FROM appointments
WHERE meeting_kind = 'at_business'
  AND NOT (tenant_id = 'fea1d3c6-93c6-4a7f-8c31-2511286789d5' AND customer_name = 'Joel');
