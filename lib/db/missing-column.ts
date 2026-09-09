// "THIS DATABASE HAS NOT BEEN MIGRATED YET", told apart from every other failure.
//
// Migrations in this project are run by hand in the Supabase SQL editor, so every deploy has a
// window — sometimes days long — where the code knows about a column and the database does not.
// Code written for that window has to do one of two things, and which one is a judgement about the
// data, not about the error:
//
//   REFUSE THE WRITE  when dropping the field would lose something the user typed and believes is
//                     saved. lib/contacts/company-column.ts does this for a company name, and it is
//                     right to: silently discarding "M&P Yacht Centre" is worse than an error.
//
//   DROP THE FIELD    when the field is an addition to an operation that must still succeed. An
//                     approval whose deadline could not be stored is still an approval, and failing
//                     the send would be a worse outcome than a missing date.
//
// This module only IDENTIFIES the condition. The choice between the two stays at the call site,
// where the thing being written is known.
//
// ── THE TWO CODES ───────────────────────────────────────────────────────────────────────────────
//
//   42703    Postgres' own undefined_column. What a SELECT of a missing column returns.
//   PGRST204 PostgREST's "column not found in the schema cache". What an INSERT or UPDATE returns,
//            because PostgREST validates the payload against its cached schema before the statement
//            ever reaches the database.
//
// Handling only one of them is a real bug that has already happened here once: the read fell back
// correctly and the write showed the owner a raw schema-cache message.
const UNDEFINED_COLUMN = new Set(['42703', 'PGRST204'])

export interface DbError { code?: string; message?: string }

/**
 * True when `error` is specifically "that column does not exist", for one of the named columns.
 *
 * NAMING THE COLUMN IS NOT OPTIONAL. A bare code check would treat an undefined_column error about
 * something else entirely — a typo in an unrelated select, a column dropped by a different
 * migration — as "not migrated yet", and the caller would quietly retry a query that is simply
 * wrong. The message is matched as well so the fallback fires for the column it was written for and
 * for nothing else.
 */
export function isMissingColumn(error: DbError | null | undefined, ...columns: string[]): boolean {
  if (!error || columns.length === 0) return false
  if (!UNDEFINED_COLUMN.has(error.code ?? '')) return false
  const message = error.message ?? ''
  return columns.some((c) => message.includes(c))
}
