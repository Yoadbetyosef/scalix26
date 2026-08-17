-- ============================================================================
-- ASK RUDI TO RESCHEDULE — the state that outlives the message.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- The button exists on the agenda and is disabled. This is the table behind it.
--
-- ── WHY A ROW AND NOT A STATUS ─────────────────────────────────────────────
--
-- The obvious shape is appointments.status = 'pending_move'. It is wrong, and
-- the reason is the rule the owner set: THE APPOINTMENT STAYS WHERE IT IS until
-- something valid lands. It is still confirmed, at its original time, and a
-- customer who never replies must still be expected at 11am on Tuesday.
--
-- What is pending is not the appointment. It is a REQUEST about it. Those are
-- different objects with different lifetimes, and collapsing them would make
-- the calendar lie during the window where the answer is unknown.
--
-- ── WHY THE OFFERED SLOTS ARE STORED ───────────────────────────────────────
--
-- This is the whole reason the table exists rather than a timestamp.
--
-- A reply arrives two days later saying "Thursday works". Thursday is only
-- meaningful against WHAT WAS OFFERED — and by then one of those slots may have
-- been taken by somebody else. Without this column the agent has to guess from
-- free text, and the failure is silent: it reads a booking keyword, finds
-- nothing to attach it to, and starts arranging a SECOND appointment while the
-- first sits untouched.
--
-- With it, the reply is resolved against a known set of two or three, and the
-- clash case has an answer: the slot is re-checked at reply time, and if it has
-- gone the agent apologises and offers what is actually free. The appointment
-- does not move until a valid slot lands.
--
-- ── WHY THE MESSAGE TEXT IS STORED ─────────────────────────────────────────
--
-- The owner is shown the exact words before it sends. Keeping them means they
-- can be shown again afterwards — "this is what went out in your name" — which
-- is the same promise, kept later. A message sent as you, to your customer,
-- should never be something you cannot go back and read.
--
-- ── ONE PENDING MOVE PER APPOINTMENT ───────────────────────────────────────
--
-- A partial unique index. Pressing the button twice must not put two live
-- offers in front of one customer, each holding different slots, with whichever
-- reply arrives first winning silently.
-- ============================================================================

CREATE TABLE IF NOT EXISTS appointment_moves (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  appointment_id  uuid NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  -- The thread the reply will arrive in. Null when the customer has no
  -- conversation yet; the reply matcher then falls back to the phone number.
  conversation_id uuid,

  -- [{ "date": "2026-08-20", "time": "11:00", "label": "Thursday 11:00 AM" }, …]
  -- The label is what the customer was actually shown, kept so the agent can
  -- quote it back rather than re-deriving a phrase that may read differently.
  offered         jsonb NOT NULL,

  -- Exactly what went out, in the owner name. See above.
  message_sent    text NOT NULL,

  status          text NOT NULL DEFAULT 'pending',
  sent_at         timestamptz NOT NULL DEFAULT now(),
  -- Nothing sits in limbo silently. An unanswered request expires and the
  -- agenda says so rather than showing a confirmed appointment nobody has
  -- agreed to keep.
  expires_at      timestamptz NOT NULL,
  resolved_at     timestamptz,
  -- What they picked, once one lands. Same shape as one element of `offered`.
  resolved_slot   jsonb,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE appointment_moves DROP CONSTRAINT IF EXISTS appointment_moves_status_check;
ALTER TABLE appointment_moves ADD CONSTRAINT appointment_moves_status_check
  CHECK (status IN (
    'pending',    -- sent, waiting on the customer
    'booked',     -- they picked one and the appointment moved
    'expired',    -- no reply before expires_at
    'cancelled'   -- the owner withdrew it, or the appointment was cancelled
  ));

-- The one that matters: a single live offer per appointment.
CREATE UNIQUE INDEX IF NOT EXISTS appointment_moves_one_pending
  ON appointment_moves (appointment_id) WHERE status = 'pending';

-- The reply matcher's lookup: given a conversation, is anything waiting?
CREATE INDEX IF NOT EXISTS appointment_moves_conversation_idx
  ON appointment_moves (conversation_id, status) WHERE status = 'pending';

-- The expiry sweep.
CREATE INDEX IF NOT EXISTS appointment_moves_expiry_idx
  ON appointment_moves (expires_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS appointment_moves_tenant_idx
  ON appointment_moves (tenant_id, status, sent_at DESC);

-- Same shape as appointments and appointment_slots in add_appointments_reviews.sql.
-- (The first draft of this policy read `tenant_id IN (SELECT id FROM tenants WHERE id = tenant_id)`,
--  which is a tautology and would have let any signed-in user read every tenant's moves. Kept in the
--  comment because it looks plausible and somebody will write it again.)
ALTER TABLE appointment_moves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant appointment moves access" ON appointment_moves;
CREATE POLICY "Tenant appointment moves access" ON appointment_moves
  FOR ALL USING (tenant_id = get_tenant_id());

COMMENT ON TABLE appointment_moves IS
  'A request to move an appointment, sent to the customer, waiting on their reply. NOT a state of the appointment: the appointment stays confirmed at its original time until a valid slot lands, so a customer who never replies is still expected when they were.';
COMMENT ON COLUMN appointment_moves.offered IS
  'The two or three slots actually offered, with the label the customer saw. The reply is resolved against THIS, not against what is free now — and a slot that has since gone is the clash case: apologise, re-offer, leave the appointment alone.';
COMMENT ON COLUMN appointment_moves.message_sent IS
  'The exact text that went out in the owner name. They were shown it before sending; this is how they can read it again afterwards.';
COMMENT ON COLUMN appointment_moves.expires_at IS
  'After this, the sweep marks it expired and the agenda says so. An appointment nobody has agreed to keep must not go on looking simply confirmed.';

-- ── Verify ─────────────────────────────────────────────────────────────────

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'appointment_moves' ORDER BY ordinal_position;

-- Expect four: the status check plus the three named indexes.
SELECT conname FROM pg_constraint WHERE conname = 'appointment_moves_status_check';
SELECT indexname FROM pg_indexes
WHERE tablename = 'appointment_moves' ORDER BY indexname;

-- Expect 0 — nothing is created by this migration.
SELECT count(*) AS moves FROM appointment_moves;

-- The guard that the atomic move relies on, unchanged and still there: a plain
-- UPDATE of slot_date/slot_time raises 23505 if the target is taken, so moving
-- needs no RPC of its own.
SELECT indexdef FROM pg_indexes WHERE indexname = 'uniq_appt_active_slot';
