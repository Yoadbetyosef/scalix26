// READING A TABLE THAT MAY NOT HAVE THE COLUMN YET.
//
// ── THE FAULT THIS EXISTS TO PREVENT, WHICH IT ALREADY CAUSED ONCE ──────────────────────────────
//
// `company_name` arrives in add_contact_company.sql, and that file is run by hand in the Supabase
// SQL editor — so there is a window, possibly days long, where this code is deployed and the column
// is not there. In that window PostgREST answers `select=id,name,company_name` with
//
//     400  {"code":"42703","message":"column contacts.company_name does not exist"}
//
// and `listContactsPage` destructured `{ data, count }` without looking at `error`. `data` came back
// null, the page rendered its empty state, and a tenant with twenty contacts was told the address
// book was empty. Caught on the probe account before deploy; on TG's tenant it would have hidden 224
// live customer records behind "Your address book builds itself".
//
// ── WHY A RETRY AND NOT A PROBE ─────────────────────────────────────────────────────────────────
//
// A capability probe means an extra round trip on every read forever, to answer a question that
// changes exactly once. This pays nothing in the normal case: the full select is tried, and only a
// 42703 — the one error code that means "no such column" — falls back to the legacy list. The answer
// is remembered per process, so it costs one wasted query per cold start until the migration runs,
// and nothing at all afterwards.
//
// It also self-heals. The moment the SQL is run the next cold process picks the column up with no
// redeploy, and `absent` never flips back to true because a column is not removed.
//
// ── AND WHY IT IS NOT A SILENT try/catch ────────────────────────────────────────────────────────
//
// It narrows to ONE error code. Any other failure — a permission error, a dropped connection, a
// malformed filter — propagates exactly as it did before, because the whole lesson of the fault
// above is that a read which cannot fail loudly is a read that lies.

// THE TWO CODES, because reading and writing fail differently.
//
//   42703    Postgres' own undefined_column. What a SELECT of a missing column returns.
//   PGRST204 PostgREST's "column not found in the schema cache". What an INSERT or UPDATE returns,
//            because PostgREST validates the payload against its cached schema before it ever
//            reaches the database.
//
// Only 42703 was handled at first, so the read fell back correctly and the write showed the owner a
// raw cache message. Both are the same fact: this database has not been migrated yet.
const UNDEFINED_COLUMN = new Set(['42703', 'PGRST204'])

/** Remembered per process. `false` once a query has succeeded with the column in it. */
let absent = false

export const companyColumnMissing = (): boolean => absent

/** True when this is specifically "that column does not exist", not any other failure. */
export function isMissingCompanyColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return UNDEFINED_COLUMN.has(error.code ?? '') && /company_name|first_name|last_name/.test(error.message ?? '')
}

/**
 * Run a query with the B2B columns, and once — and only once — retry without them if the database
 * has not been migrated yet.
 *
 * Both callbacks take the column list to select, so the caller writes its query once and this
 * decides which spelling to hand it.
 */
export async function withCompanyColumns<T>(
  full: string,
  legacy: string,
  run: (cols: string) => Promise<{ data: T | null; error: { code?: string; message?: string } | null; count?: number | null }>,
): Promise<{ data: T | null; error: { code?: string; message?: string } | null; count?: number | null; degraded: boolean }> {
  if (absent) return { ...(await run(legacy)), degraded: true }

  const first = await run(full)
  if (!isMissingCompanyColumn(first.error)) return { ...first, degraded: false }

  // One-way latch: from here on this process asks for the legacy shape and stops paying for the
  // failed attempt.
  absent = true
  return { ...(await run(legacy)), degraded: true }
}

/**
 * A WRITE DOES NOT FALL BACK.
 *
 * Reading without the column shows less than the truth, which is recoverable. Writing without it
 * would accept "M&P Yacht Centre" into the form, drop it on the floor and report success — the
 * owner would believe the company was saved and find out weeks later that it never was. So the save
 * is refused, and the message says exactly which file has not been run.
 */
export const MIGRATION_HINT = 'run add_contact_company.sql in the Supabase SQL editor'

export function writeError(error: { code?: string; message?: string } | null | undefined): string | null {
  if (!error) return null
  if (isMissingCompanyColumn(error)) {
    absent = true
    return `Company and split names are not set up on this database yet — ${MIGRATION_HINT}.`
  }
  return error.message ?? 'Could not save.'
}
