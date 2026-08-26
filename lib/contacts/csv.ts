import type { ImportRow } from './store'
import { parseDelimited, detectDelimiter } from '@/lib/csv/parse'

// Header auto-mapping for the contact importer. The reader itself lives in lib/csv/parse.ts — the
// ingestion module parses the same kind of file and a spreadsheet must not depend on which door it
// came through. Re-exported here so existing importers of this module keep working.
export { parseDelimited, detectDelimiter }

export type ContactField = keyof ImportRow
export const CONTACT_FIELDS: Array<{ key: ContactField; label: string }> = [
  { key: 'company_name', label: 'Company' },
  { key: 'first_name', label: 'First name' }, { key: 'last_name', label: 'Last name' },
  { key: 'name', label: 'Full name' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' }, { key: 'currency', label: 'Currency' }, { key: 'notes', label: 'Notes' },
]

// Header spellings we recognise without asking. Anything unmatched is left for the user to map by hand.
//
// ── 'first name' MOVED, AND IT WAS A BUG ────────────────────────────────────────────────────────
//
// It used to be an alias for `name`. A spreadsheet with First Name and Last Name columns — which is
// what a B2B address book exports — mapped First Name onto the single name field and left Last Name
// with nowhere to go, so every surname in the file was silently dropped at import. The columns are
// real fields now and the alias belongs to the one it names.
//
// Order matters: autoMapHeaders claims fields first-come, and these are declared before `name` so a
// file carrying both "First Name" and "Name" fills the parts rather than the whole.
const HEADER_ALIASES: Record<ContactField, string[]> = {
  company_name: ['company', 'company name', 'business', 'business name', 'organisation', 'organization', 'org', 'account', 'account name', 'firm'],
  first_name: ['first name', 'firstname', 'first', 'given name', 'forename'],
  last_name: ['last name', 'lastname', 'last', 'surname', 'family name'],
  name: ['name', 'full name', 'fullname', 'customer', 'customer name', 'client', 'client name', 'contact', 'contact name'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  phone: ['phone', 'phone number', 'telephone', 'tel', 'mobile', 'cell', 'cell phone', 'contact number'],
  address: ['address', 'street', 'street address', 'mailing address', 'location'],
  currency: ['currency', 'ccy'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks'],
}

const canon = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')

// Best-guess column → field mapping. Returns one entry per column; null means "don't import this column".
export function autoMapHeaders(headers: string[]): Array<ContactField | null> {
  const taken = new Set<ContactField>()
  return headers.map((h) => {
    const c = canon(h)
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[ContactField, string[]]>) {
      if (taken.has(field)) continue
      if (aliases.includes(c)) { taken.add(field); return field }
    }
    return null
  })
}

// A header row is only a header if at least one column looks like a known field name — otherwise the file
// starts straight at the data and we must not eat the first contact.
export const looksLikeHeaderRow = (cells: string[]): boolean =>
  autoMapHeaders(cells).some((f) => f !== null)

export interface ParsedFile { headers: string[]; rows: string[][]; mapping: Array<ContactField | null>; hasHeaderRow: boolean }

export function parseContactsFile(text: string): ParsedFile {
  const grid = parseDelimited(text, detectDelimiter(text))
  if (!grid.length) return { headers: [], rows: [], mapping: [], hasHeaderRow: false }
  const hasHeaderRow = looksLikeHeaderRow(grid[0])
  const width = Math.max(...grid.map((r) => r.length))
  const headers = hasHeaderRow
    ? Array.from({ length: width }, (_, i) => grid[0][i]?.trim() || `Column ${i + 1}`)
    : Array.from({ length: width }, (_, i) => `Column ${i + 1}`)
  return {
    headers,
    rows: (hasHeaderRow ? grid.slice(1) : grid).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')),
    mapping: hasHeaderRow ? autoMapHeaders(headers) : Array.from({ length: width }, () => null),
    hasHeaderRow,
  }
}

/**
 * Point one column at a field, and take that field away from whichever column had it.
 *
 * A field can only come from ONE column. This rule lived inside the v1 import component; it is here
 * because there are two importers now, and a rule copied into both is a rule that will drift. Moved
 * verbatim — same three lines, same behaviour — not rewritten.
 */
export function reassignMapping(
  mapping: Array<ContactField | null>,
  col: number,
  field: ContactField | null,
): Array<ContactField | null> {
  const next = mapping.map((f, i) => (field && f === field && i !== col ? null : f))
  next[col] = field
  return next
}

// Apply the (possibly hand-corrected) mapping to produce the rows sent to the server.
export function toImportRows(rows: string[][], mapping: Array<ContactField | null>): ImportRow[] {
  return rows.map((cells) => {
    const out: ImportRow = {}
    mapping.forEach((field, i) => {
      if (!field) return
      const v = (cells[i] ?? '').trim()
      if (v) out[field] = v
    })
    return out
  }).filter((r) => Object.keys(r).length > 0)
}
