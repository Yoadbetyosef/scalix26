import { anthropic } from '@/lib/anthropic/client'
import { trackLlm } from '@/lib/cost/track'
import { MAX_INVOICE_PAGES } from './types'

// Reading a supplier invoice.
//
// ── WHY THE DOCUMENT GOES TO THE MODEL WHOLE ────────────────────────────────────────────────────────
//
// pdf-parse is already a dependency and could turn this PDF into a string, but an invoice's meaning is
// in its COLUMN LAYOUT: which number is a unit price, which is a line total, which is the freight line
// at the bottom. Flattening the table to a text stream destroys exactly the association the extraction
// depends on, and no prompt recovers it afterwards. The document goes as a document.
//
// pdf-parse is still used here, lazily, for one thing: counting pages before spending anything.
//
// ── MODEL ───────────────────────────────────────────────────────────────────────────────────────────
//
// Sonnet rather than the Haiku the rest of this app uses. This is the one path where a misread digit
// becomes a wrong cost, becomes a wrong price, and nobody finds out — the error is invisible at every
// later step. Volume is a handful of invoices a month, so a few cents each is noise against a single
// mispriced product. Its rate row is in lib/cost/rates.ts; without one, spend would be silently
// under-reported at Haiku's price.

export const EXTRACTION_MODEL = 'claude-sonnet-5'

/**
 * Structured outputs, not prompt-and-hope. The response is constrained to this schema by the API, so
 * there is no parse step that can fail at midnight and no retry loop around a regex. Numbers arrive as
 * numbers.
 *
 * Nullable fields are written as `anyOf` rather than `type: [..., 'null']` — the supported subset of
 * JSON Schema is narrow, and anyOf is in it.
 */
const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] })

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
 * Page count from PDF metadata alone — getInfo(), not getText(), so nothing renders and no text is
 * extracted. Loaded lazily because pdf-parse pulls in ~36MB of pdfjs and most of this app never needs it.
 *
 * Returns null for images, which have no page count and are one page by definition.
 */
export async function pageCountOf(bytes: Buffer, mimeType: string): Promise<number | null> {
  if (mimeType !== 'application/pdf') return null
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: bytes })
  try {
    return (await parser.getInfo()).total
  } finally {
    await (parser as { destroy?: () => Promise<void> }).destroy?.()
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
  const pageCount = await pageCountOf(bytes, mimeType)

  // Checked BEFORE the API call, so an oversized document costs nothing. A refusal that names the page
  // count sends the owner to split the file; a truncation would send a wrong landed cost to every
  // product on it, with nothing on screen to reveal it.
  if (pageCount !== null && pageCount > MAX_INVOICE_PAGES) {
    throw new Error(
      `This invoice is ${pageCount} pages and the limit is ${MAX_INVOICE_PAGES}. ` +
      `Split it and upload the parts separately — reading only part of it would spread the shipping across the wrong products.`,
    )
  }

  // base64 with no newlines, and the document BEFORE the instruction — both are how the API expects a
  // document turn to be shaped.
  const data = bytes.toString('base64')
  const source = { type: 'base64' as const, media_type: mimeType, data }
  const documentBlock = mimeType === 'application/pdf'
    ? { type: 'document' as const, source: { ...source, media_type: 'application/pdf' as const } }
    : { type: 'image' as const, source: source as { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string } }

  // Streamed: a long invoice's structured output can run past the point where a non-streaming request
  // risks an SDK HTTP timeout, and the failure mode there is a lost extraction the owner already paid for.
  const stream = anthropic.messages.stream({
    model: EXTRACTION_MODEL,
    max_tokens: 16000,
    // Transcription with layout comprehension: it has to follow a column across a page, but it is not
    // being asked to reason about the business. Medium buys that without paying for deliberation.
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: INVOICE_SCHEMA } },
    messages: [{ role: 'user', content: [documentBlock, { type: 'text', text: PROMPT }] }],
  } as Parameters<typeof anthropic.messages.stream>[0])

  const message = await stream.finalMessage()

  // Metered the moment it is known, with the real completion id as resourceId so the usage_events row
  // is deterministic and deduped rather than a fresh uuid per attempt.
  trackLlm(tenantId, EXTRACTION_MODEL, message.usage, { resourceId: message.id })

  // Narrowed structurally rather than with a type predicate: `content` is a union whose other members
  // have no `text`, and asserting a shape that isn't assignable to ContentBlock is how you get a cast
  // that compiles and lies. `in` narrows without claiming anything the SDK hasn't declared.
  const block = message.content.find((b) => b.type === 'text')
  const text = block && 'text' in block ? block.text : null
  if (!text) throw new Error('The model returned no content for this invoice.')

  // Guaranteed to parse and to match the schema — that is what output_config.format buys. A throw here
  // means something changed about the API, not about this invoice, and it should read that way.
  const invoice = JSON.parse(text) as ExtractedInvoice
  if (!invoice.currency) invoice.currency = fallbackCurrency

  return {
    invoice,
    pageCount,
    model: EXTRACTION_MODEL,
    inputTokens: message.usage.input_tokens ?? 0,
    outputTokens: message.usage.output_tokens ?? 0,
    completionId: message.id,
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
