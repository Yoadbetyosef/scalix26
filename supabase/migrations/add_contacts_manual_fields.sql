-- ============================================================================
-- An owner's edit to a contact is FINAL.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- ── WHAT IS WRONG TODAY ────────────────────────────────────────────────────
--
-- Three paths let the AI write `contacts.name` — /api/conversations/voice,
-- /api/appointments/book, and Speed-to-Lead — and all three guard the same way:
--
--     .update({ name }).eq('id', contactId).is('name', null)
--
-- `.is('name', null)` means "no name yet". It does NOT mean "the owner has not
-- decided". The two come apart in exactly the case an owner will hit first: a
-- wrong name is written by the AI, the owner clears it to blank, and the next
-- call writes it straight back. There is no way to say "this should be empty".
--
-- ── WHY ONE ARRAY AND NOT A COLUMN PER FIELD ───────────────────────────────
--
-- A `name_source` column works and needs a new migration every time the AI
-- learns to write another field. This is one column, once.
--
-- A single whole-row `edited_by_owner_at` would be cheaper still and is wrong:
-- an owner fixing a phone typo would freeze `name` too, so the AI could never
-- fill in a name it legitimately learns next week. The freeze has to be per
-- field, because the decisions are per field.
--
-- ── HOW IT IS READ ─────────────────────────────────────────────────────────
--
-- The edit route appends each field the owner sets or clears. The AI's writes
-- add one clause:
--
--     .is('name', null).not('manual_fields', 'cs', '{name}')
--
-- so a field the owner has touched is never written again, whatever its value.
-- Empty array = nothing decided = today's behaviour exactly, which is why this
-- migration changes nothing on its own.
-- ============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS manual_fields text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN contacts.manual_fields IS
  'Fields the OWNER has set or deliberately cleared (name, email, phone, address, currency, notes). Automated writers must skip any field named here — an empty value chosen by a person is a decision, not a gap.';

-- The AI''s guard filters on this, so it is worth an index — GIN is the operator
-- class for the array-containment operator the guard uses.
CREATE INDEX IF NOT EXISTS idx_contacts_manual_fields
  ON contacts USING GIN (manual_fields);

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect: one row (manual_fields, ARRAY, NO, '{}'::text[]), and the index.

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'contacts' AND column_name = 'manual_fields';

SELECT indexname FROM pg_indexes
WHERE tablename = 'contacts' AND indexname = 'idx_contacts_manual_fields';

-- Expect 0: nothing has been decided by a person yet, so nothing is frozen.
SELECT count(*) AS contacts_with_manual_edits
FROM contacts WHERE array_length(manual_fields, 1) IS NOT NULL;
