-- ============================================================================
-- B2B CONTACTS: a company name, and the person's name in two parts.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- ADDITIVE ONLY. Three nullable columns. **No existing row is touched** — there
-- is no UPDATE in this file and there is deliberately no backfill.
--
-- ── WHY NO BACKFILL, WHEN A SPLIT LOOKS EASY ───────────────────────────────
--
-- `contacts.name` is one free-text field and always has been. TG jewellers has
-- 224 of them, written by three different authors: typed by the owner, imported
-- from a spreadsheet, and captured by the AI off a phone call. Splitting those
-- on the first space would be a guess applied to live customer records, and it
-- guesses wrong on every one of "Anya Ergas", "M&P Yacht Centre", "Artin" and
-- the ~40% that are null. The two-part name is offered from here ON, for rows
-- somebody actually fills in; the 224 keep the single name they have and go on
-- displaying exactly as they do today.
--
-- ── WHY company_name AND NOT contacts.company_id ───────────────────────────
--
-- Both exist. `contacts.company_id` and a `companies` table shipped with the
-- Core Platform Foundation, and in production they hold: three company rows
-- across every tenant, none of them TG's, and **zero contacts with company_id
-- set**. Nothing in the app writes either, and no screen reads them.
--
-- What was asked for is a field on a contact, not a company entity with its own
-- record, its own screen and a one-to-many behind it. A plain column is the
-- honest shape of that, and it cannot drift out of sync with a parent row that
-- nobody maintains. If companies later become real objects — a company with
-- five contacts, its own history — company_name is the string to promote, and
-- promoting a string is a smaller migration than unpicking a half-used FK.
--
-- The FK stays where it is, unused and untouched. This adds no opinion about it.
-- ============================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_name   text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_name    text;

-- Search has to find a B2B customer by the company, which is the name the
-- caller says. Same trigram treatment `name` gets, so "yacht" finds
-- "M&P Yacht Centre" rather than only a prefix match.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS contacts_company_name_trgm
  ON contacts USING gin (company_name gin_trgm_ops);

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect three rows, all nullable, and a count of 0 for every one: nothing is
-- populated yet and nothing was rewritten.
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'contacts'
  AND column_name IN ('company_name', 'first_name', 'last_name')
ORDER BY column_name;

SELECT
  count(*) FILTER (WHERE company_name IS NOT NULL) AS with_company,
  count(*) FILTER (WHERE first_name   IS NOT NULL) AS with_first,
  count(*) FILTER (WHERE last_name    IS NOT NULL) AS with_last,
  count(*)                                          AS total
FROM contacts;
