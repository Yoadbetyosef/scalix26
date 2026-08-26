// HOW A CONTACT IS CALLED, in one place.
//
// ── WHAT THE ADDRESS BOOK LOOKED LIKE BEFORE THIS ───────────────────────────────────────────────
//
// One free-text `name` column, and every screen doing `c.name || c.email || c.phone || 'Unknown'`
// inline. That works for a person and has no answer for a business — which is why TG jewellers'
// live book already contains "M&P Yacht Centre" typed into the field meant for a human being, with
// no way to record who at M&P actually rings.
//
// ── THE DECISION: `name` STAYS THE PERSON ───────────────────────────────────────────────────────
//
// Three ways to hold this were possible. The one taken is the third:
//
//   1. Compose into `name` — store "M&P Yacht Centre — Irina Gavala" in the existing column. Every
//      one of the forty-odd read sites gets it free. Rejected: it makes `name` mean two different
//      things depending on the row, and the AI writes that column off live phone calls
//      (lib/contacts/ai-name.ts). A machine appending a captured first name to a composed string is
//      a corruption nobody would notice for months.
//
//   2. contacts.company_id → companies. Already in the schema, and in production it holds three
//      company rows across every tenant, none of TG's, and zero contacts pointing at one. What was
//      asked for is a field on a contact, not an entity with its own screen and a one-to-many.
//
//   3. A separate `company_name`, and ONE function that composes the display. Taken. `name` keeps
//      meaning exactly what it has always meant — the person — so every surface that has not been
//      told about companies still shows something true, just less complete. Nothing renders wrong
//      while the change rolls out, which is the property the other two lack.
//
// ── AND WHY first/last DO NOT REPLACE `name` ────────────────────────────────────────────────────
//
// They are offered from here on, for rows somebody fills in. `name` remains the canonical string and
// is DERIVED from them when they are present, so the 224 existing contacts — typed, imported and
// captured by three different authors — are never split on a guess. `personName` is that derivation
// and the store is the only caller.

export interface ContactNameParts {
  name?: string | null
  company_name?: string | null
  first_name?: string | null
  last_name?: string | null
}

const clean = (v: string | null | undefined): string => (v ?? '').trim()

/**
 * The person's name, from its two parts — or null when neither is given.
 *
 * The store writes the result into `name`, so a contact edited through the new form still reads
 * correctly on every screen that only knows about `name`. A row with one part gives that part; a row
 * with neither leaves `name` alone rather than blanking it.
 */
export function personName(first: string | null | undefined, last: string | null | undefined): string | null {
  const joined = [clean(first), clean(last)].filter(Boolean).join(' ')
  return joined || null
}

/**
 * What to show. "Company — Person" when both are known, and whichever exists when only one is.
 *
 * THE EM DASH IS THE SEPARATOR, not a comma or a bracket. "M&P Yacht Centre — Irina Gavala" reads as
 * two facts of equal standing; "M&P Yacht Centre (Irina Gavala)" makes the person a footnote to the
 * company, and "Irina Gavala, M&P Yacht Centre" sorts and scans as a person who happens to work
 * somewhere. For a jeweller whose B2B customer IS the yacht centre, the company leads.
 *
 * Falls through to email, then phone, then 'Unknown' — the same ladder every screen already used
 * inline, kept identical so no row's display changes until somebody fills the new fields in.
 */
export function contactDisplayName(c: ContactNameParts): string {
  const company = clean(c.company_name)
  const person = clean(c.name) || clean(personName(c.first_name, c.last_name) ?? '')
  if (company && person) return `${company} — ${person}`
  return company || person || 'Unknown'
}

/**
 * The same ladder, but falling back to the identifiers when there is no name at all.
 *
 * /contacts and /inbox both need this: roughly 40% of TG's book arrived from a phone call with
 * nothing but a number. Kept separate from contactDisplayName because a document that prints
 * "Unknown" is wrong in a different way from a list row that does.
 */
export function contactDisplayOrIdentifier(
  c: ContactNameParts & { email?: string | null; phone?: string | null },
): string {
  const named = contactDisplayName(c)
  if (named !== 'Unknown') return named
  return clean(c.email) || clean(c.phone) || 'Unknown'
}

/** The letter on the avatar. Takes the company's initial for a business, which is what you scan for. */
export const contactInitial = (c: ContactNameParts & { email?: string | null; phone?: string | null }): string =>
  contactDisplayOrIdentifier(c)[0]?.toUpperCase() || '?'

/** True when this contact represents a business rather than a private customer. */
export const isBusinessContact = (c: ContactNameParts): boolean => clean(c.company_name).length > 0
