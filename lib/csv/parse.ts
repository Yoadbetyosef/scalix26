// Minimal RFC-4180 CSV/TSV reader, with no dependency. Pure — no imports, no I/O, no framework —
// so it runs unchanged in the browser (the contacts import parses on the spot), in a route handler,
// and in the standalone catalog worker.
//
// Lifted out of lib/contacts/csv.ts when the ingestion module needed the same reader: a spreadsheet
// quoted by Excel has to parse identically wherever it arrives, and three divergent parsers was the
// alternative.

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

// Parse into rows keyed by header name, lower-cased and trimmed. The shape most callers want when
// the file is known to carry a header row.
export function parseWithHeaders(text: string): Array<Record<string, string>> {
  const grid = parseDelimited(text, detectDelimiter(text))
  if (grid.length < 2) return []
  const headers = grid[0].map((h) => h.trim().toLowerCase())
  return grid.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])))
}
