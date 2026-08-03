import type { ImportRow } from './store'

// Minimal RFC-4180 CSV/TSV reader plus header auto-mapping, with no dependency. Runs in the browser so an
// imported file is parsed on the spot and only the recognised rows are sent to the server.

// Splits on the delimiter while honouring quoted fields, "" escapes, and newlines inside quotes.
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  // Normalise line endings first so \r\n inside the data can't produce phantom empty fields.
  const src = text.replace(/\r\n?/g, '\n')

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }   // escaped quote
        else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === delimiter) { row.push(field); field = ''; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += ch
  }
  // Trailing field/row (a file that doesn't end in a newline).
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// Tab-separated files (a straight copy-paste out of Excel) are common enough to detect rather than ask about.
export const detectDelimiter = (text: string): string => {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const tabs = (firstLine.match(/\t/g) ?? []).length
  const commas = (firstLine.match(/,/g) ?? []).length
  const semis = (firstLine.match(/;/g) ?? []).length
  if (tabs > commas && tabs > semis) return '\t'
  if (semis > commas) return ';'                     // European Excel exports
  return ','
}

export type ContactField = keyof ImportRow
export const CONTACT_FIELDS: Array<{ key: ContactField; label: string }> = [
  { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' }, { key: 'currency', label: 'Currency' }, { key: 'notes', label: 'Notes' },
]

// Header spellings we recognise without asking. Anything unmatched is left for the user to map by hand.
const HEADER_ALIASES: Record<ContactField, string[]> = {
  name: ['name', 'full name', 'fullname', 'customer', 'customer name', 'client', 'client name', 'contact', 'contact name', 'first name'],
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
