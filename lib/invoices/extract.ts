import { nullable, readDocument } from '@/lib/anthropic/read-document'
import { MAX_INVOICE_PAGES } from './types'

// Reading a supplier invoice.
//
// What is HERE is what is particular to an invoice: the schema, the prompt, the page ceiling, and the
// fallback currency. The call itself — document turn, streaming, structured output, metering, the
// narrowing of the response — is in lib/anthropic/read-document.ts, shared with the receipt reader.
// See that file's header for why the document goes to the model whole.
//
// ── MODEL ───────────────────────────────────────────────────────────────────────────────────────────
//
// Sonnet rather than the Haiku the rest of this app uses. This is the one path where a misread digit
// becomes a wrong cost, becomes a wrong price, and nobody finds out — the error is invisible at every
// later step. Volume is a handful of invoices a month, so a few cents each is noise against a single
// mispriced product. Its rate row is in lib/cost/rates.ts; without one, spend would be silently
// under-reported at Haiku's price.

export const EXTRACTION_MODEL = 'claude-sonnet-5'

const LINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['description', 'sku', 'quantity', 'unitPrice', 'lineTotal'],
  properties: {
    description: nullable('string'),
    sku: nullable('string'),
    quantity: nullable('number'),
    unitPrice: nullable('number'),
    // The line's own total as PRINTED. Preferred over quantity x unitPrice because an invoice may carry
    // a per-line discount that neither of those two numbers shows.
    lineTotal: nullable('number'),
  },
}

const INVOICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'supplierName', 'invoiceNumber', 'invoiceDate', 'currency',
    'subtotal', 'taxTotal', 'freightTotal', 'dutiesTotal', 'otherTotal', 'grandTotal', 'lines',
  ],
  properties: {
    supplierName: nullable('string'),
    invoiceNumber: nullable('string'),
    invoiceDate: nullable('string'),      // ISO 8601 date; the prompt says so and the parser tolerates junk
    currency: { type: 'string' },         // ISO 4217, or the tenant's base if the document never says
    subtotal: nullable('number'),
    taxTotal: nullable('number'),
    freightTotal: nullable('number'),
    dutiesTotal: nullable('number'),
    otherTotal: nullable('number'),
    grandTotal: nullable('number'),
    lines: { type: 'array', items: LINE_SCHEMA },
  },
}

export interface ExtractedLine {
  description: string | null
  sku: string | null
  quantity: number | null
  unitPrice: number | null
  lineTotal: number | null
}

export interface ExtractedInvoice {
  supplierName: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  currency: string
  subtotal: number | null
  taxTotal: number | null
  freightTotal: number | null
  dutiesTotal: number | null
  otherTotal: number | null
  grandTotal: number | null
  lines: ExtractedLine[]
}

export interface ExtractionResult {
  invoice: ExtractedInvoice
  pageCount: number | null
  model: string
  inputTokens: number
  outputTokens: number
  completionId: string
}

const PROMPT = `You are reading a supplier invoice for an importer who needs to know what their goods cost to land.

Extract every product line, and the charges at the bottom of the invoice.

Rules:
- Transcribe the numbers EXACTLY as printed. Do not calculate, correct, or reconcile anything. If the invoice's own arithmetic is wrong, report what it says.
- lineTotal is the line's printed total. Use null if the invoice shows no per-line total — do not multiply quantity by unit price to invent one.
- Product lines only. Freight, duty, tax, handling, insurance, discounts and totals are NOT product lines; they belong in the charge fields.
- freightTotal is shipping/carriage/delivery. dutiesTotal is customs duty or tariff. otherTotal is handling, insurance, brokerage or similar. Anything you cannot place confidently goes in otherTotal.
- currency is the ISO code the invoice is denominated in (EUR, USD, GBP…). If the document truly never states one, return the empty string rather than guessing.
- invoiceDate as YYYY-MM-DD.
- Use null for anything genuinely absent. Never substitute 0 for a number you could not find: 0 means the invoice says zero.`

/**
 * How many pages, if we can tell cheaply. Null means "unknown" — never an error.
 *
 * ── WHY THIS DOES NOT USE pdf-parse ─────────────────────────────────────────────────────────────────
 *
 * It did, via getInfo(). On Vercel that threw `ReferenceError: DOMMatrix is not defined` — pdfjs
 * reaches for browser globals that do not exist in the serverless runtime — and because the count was
 * computed BEFORE the API call, the throw took the whole upload with it. The first real invoice ever
 * put through this feature died on a page count it did not need. (pdf-parse/node exports only
 * getHeader, so there is no Node-safe build to switch to.)
 *
 * The deeper mistake was structural, not a bad import: this is an OPTIMISATION — it exists to avoid
 * spending money on a document too large to read — and an optimisation must never be able to fail the
 * thing it is optimising. So it now has no dependencies, cannot throw, and is allowed to shrug.
 *
 * The scan is deliberately simple: count page objects, and fall back to the largest /Count in the page
 * tree. Both live in the file's plain bytes and read correctly on ordinary PDFs. Neither can see inside
 * a compressed object stream, so some files come back null — measured at 5 of 8 real PDFs answering,
 * 3 shrugging. That is the honest result and the caller is built for it.
 */
export function pageCountOf(bytes: Buffer, mimeType: string): number | null {
  if (mimeType !== 'application/pdf') return null   // an image is one page by definition
  try {
    // latin1 keeps every byte a single character, so offsets in binary sections cannot corrupt a match.
    const s = bytes.toString('latin1')
    // `/Type /Page` but not `/Pages` (the tree node) and not `/PageLabels` and friends.
    const pages = (s.match(/\/Type\s*\/Page(?![sA-Za-z])/g) || []).length
    if (pages > 0) return pages
    const counts = [...s.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1])).filter(Number.isFinite)
    return counts.length ? Math.max(...counts) : null
  } catch {
    return null
  }
}

/**
 * Read one invoice.
 *
 * `tenantId` is here only so the spend lands on the right meter — extraction reads nothing from the
 * database. The caller has already resolved and authorised it.
 */
export async function extractInvoice(
  tenantId: string,
  bytes: Buffer,
  mimeType: string,
  fallbackCurrency: string,
): Promise<ExtractionResult> {
  const pageCount = pageCountOf(bytes, mimeType)

  // Checked BEFORE the API call, so an oversized document costs nothing. A refusal that names the page
  // count sends the owner to split the file; a truncation would send a wrong landed cost to every
  // product on it, with nothing on screen to reveal it.
  //
  // `pageCount === null` means we could not tell, and that is NOT a reason to refuse. The API enforces
  // its own page ceiling, so an unreadable count costs at worst one rejected call — against an upload
  // that cannot proceed at all, which is what refusing on uncertainty would produce.
  if (pageCount !== null && pageCount > MAX_INVOICE_PAGES) {
    throw new Error(
      `This invoice is ${pageCount} pages and the limit is ${MAX_INVOICE_PAGES}. ` +
      `Split it and upload the parts separately — reading only part of it would spread the shipping across the wrong products.`,
    )
  }

  const read = await readDocument<ExtractedInvoice>({
    tenantId,
    bytes,
    mimeType,
    schema: INVOICE_SCHEMA,
    prompt: PROMPT,
    model: EXTRACTION_MODEL,
    // Transcription with layout comprehension: it has to follow a column across a page, but it is not
    // being asked to reason about the business. Medium buys that without paying for deliberation.
    effort: 'medium',
    subject: 'invoice',
  })

  const invoice = read.value
  if (!invoice.currency) invoice.currency = fallbackCurrency

  return {
    invoice,
    pageCount,
    model: read.model,
    inputTokens: read.inputTokens,
    outputTokens: read.outputTokens,
    completionId: read.completionId,
  }
}

/**
 * The allocation weight for a line: what the invoice says the line came to.
 *
 * Falls back to quantity x unit price when the document prints no line total — the extraction is told
 * not to invent one, so the fallback lives here where it is visible, rather than inside the model's
 * answer where it would be indistinguishable from something actually printed on the page.
 */
export function extendedOf(line: ExtractedLine): number {
  if (line.lineTotal !== null && Number.isFinite(line.lineTotal)) return Math.max(0, line.lineTotal)
  const q = line.quantity ?? 0
  const u = line.unitPrice ?? 0
  const v = q * u
  return Number.isFinite(v) && v > 0 ? v : 0
}
