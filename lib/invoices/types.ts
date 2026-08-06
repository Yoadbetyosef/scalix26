// Supplier-invoice / landed-cost shapes and limits — ISOMORPHIC, no server imports, so the upload UI,
// the approval screen and the server all enforce exactly the same rules. (lib/invoices/store.ts reaches
// next/headers and can never be imported by a client component; this is its shared half.)

import { INVOICE_EXTENSIONS, MAX_INVOICE_BYTES, extensionOf } from '@/lib/orders/attachment-types'

// Deliberately re-exported rather than redefined. `INVOICE_EXTENSIONS` already exists for the public
// factory hand-off and encodes the same judgement this feature needs — an invoice is a document or a
// photo of one, and does not inherit the wide CAD/video allowlist. A second list would be a second
// thing to keep in step.
export { INVOICE_EXTENSIONS, MAX_INVOICE_BYTES, extensionOf }
/**
 * The subset we can actually READ.
 *
 * INVOICE_EXTENSIONS includes heic/heif because that is what an iPhone photo is, and for the factory
 * hand-off — where a human opens the file — that is exactly right. Extraction is different: the vision
 * API takes png, jpeg, webp and gif, and a HEIC would be accepted, stored, and then fail at the point
 * the owner is waiting on an answer. Better to say so at the file picker.
 */
export const EXTRACTABLE_MEDIA_TYPES = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
])

export const EXTRACTABLE_EXTENSIONS: Record<string, string> = Object.fromEntries(
  Object.entries(INVOICE_EXTENSIONS).filter(([, mime]) => EXTRACTABLE_MEDIA_TYPES.has(mime)),
)

export const INVOICE_ACCEPT_ATTR = Object.keys(EXTRACTABLE_EXTENSIONS).map((e) => `.${e}`).join(',')

/** Why a file was refused, phrased for the person holding it. */
export function invoiceFileError(fileName: string, size: number): string | null {
  const ext = extensionOf(fileName)
  if (!EXTRACTABLE_EXTENSIONS[ext]) {
    if (INVOICE_EXTENSIONS[ext]) {
      return `.${ext} files can't be read automatically. On an iPhone, Share → Print → save as PDF, or change Settings → Camera → Formats to “Most Compatible”.`
    }
    return `Can't read a .${ext || 'unknown'} file. Upload the invoice as a PDF or a photo (JPG, PNG).`
  }
  if (size > MAX_INVOICE_BYTES) {
    return `That file is ${(size / 1024 / 1024).toFixed(0)} MB — the limit is ${MAX_INVOICE_BYTES / 1024 / 1024} MB.`
  }
  return null
}

/**
 * The page ceiling for extraction.
 *
 * Not a byte limit — bytes are already capped at 20 MB, comfortably inside the API's 32 MB request
 * limit even after base64 inflates them by a third. The binding constraint is TOKENS: a PDF bills as
 * image tokens per page, roughly 1,500–3,000 of them, so a 40-page document is ~100K tokens of input
 * before a word of prompt. Real supplier invoices are one to five pages.
 *
 * The reason this is a hard refusal and not a truncation: a truncated invoice still produces an
 * allocation, and that allocation's denominator is wrong in a way nothing on screen could reveal. An
 * error naming the actual page count sends the owner to split the file; a silent truncation sends a
 * wrong landed cost to every product on it.
 */
export const MAX_INVOICE_PAGES = 20

/**
 * How much of the invoice's value must be matched to products before an allocation may be applied.
 *
 * The number itself is a judgement call; what it protects against is not. Freight is spread across
 * matched lines only, so at 40% coverage the matched products absorb the whole shipment's freight
 * including the part that belongs to goods nobody identified — each one overstated by roughly 2.5x.
 * Below this line the right move is to go match the missing lines, not to accept the allocation, and
 * the screen says so. An explicit override exists because sometimes the unmatched lines really are
 * things the business does not stock.
 */
export const MIN_COVERAGE = 0.8

export type ShipmentStatus = 'draft' | 'extracting' | 'review' | 'applied' | 'failed'
export type InvoiceStatus = 'uploaded' | 'extracting' | 'extracted' | 'failed'
export type LineStatus = 'unmatched' | 'matched' | 'skipped'
export type MatchMethod = 'exact_sku' | 'normalized_sku' | 'name_trigram' | 'manual'

export interface Shipment {
  id: string
  reference: string | null
  currency: string
  freightTotal: number
  dutiesTotal: number
  otherTotal: number
  status: ShipmentStatus
  appliedAt: string | null
  createdAt: string
}

export interface SupplierInvoice {
  id: string
  shipmentId: string
  supplierName: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  currency: string
  subtotal: number | null
  taxTotal: number | null
  grandTotal: number | null
  fileName: string
  fileSize: number
  pageCount: number | null
  status: InvoiceStatus
  extractionError: string | null
  /** Anything that limited the matching, in the owner's words. Null when nothing did. */
  matchNote: string | null
  /**
   * Base currency per one unit of THIS invoice's currency — the rate the owner actually paid, typed by
   * hand. Applies to line values only. Freight is never multiplied by it: freight arrives from the
   * forwarder already in base currency, so there is nothing to convert.
   *
   * Null is ordinary for an invoice already in base currency. Null on a FOREIGN invoice blocks Apply.
   */
  exchangeRate: number | null
  /**
   * Freight/duty/other as printed on the SUPPLIER's invoice, in the invoice's currency.
   *
   * Evidence, never a value. Shown beside the forwarder's figures so the owner can spot the same
   * shipment quoted twice; never written to the shipment's charges.
   */
  extractedFreight: number | null
  extractedDuties: number | null
  extractedOther: number | null
  extractionCostUsd: number | null
  createdAt: string
}

export interface InvoiceLine {
  id: string
  lineNo: number
  description: string | null
  sku: string | null
  quantity: number | null
  unitPrice: number | null
  /** Allocation weight: the line's own total, taken from the document or computed from qty x price. */
  extended: number
  productId: string | null
  /** Denormalised for display — the approval screen must show what was matched, not just that it was. */
  productName?: string | null
  productSku?: string | null
  matchMethod: MatchMethod | null
  matchConfidence: number | null
  status: LineStatus
  allocatedFreight: number
  allocatedDuties: number
  /**
   * Another APPLIED shipment already put freight on this product.
   *
   * A product's shipping_cost is REPLACED by an apply, not added to — correct when one product carries
   * one shipment's freight, wrong the moment the same sofa is reordered. Applying this shipment erases
   * what the earlier one wrote, and the margin on that product is wrong from then on with nothing on
   * screen to say so.
   *
   * The modelling fix is Phase 2. Until then this makes it a visible decision instead of a silent
   * number: it does not block, because re-ordering the same product and wanting the newer freight is
   * the common, correct case.
   */
  priorShipment?: { id: string; reference: string | null; appliedAt: string | null; amount: number } | null
}

/** What a shipment's approval screen needs, in one object. */
export interface ShipmentDetail {
  shipment: Shipment
  invoice: SupplierInvoice
  lines: InvoiceLine[]
  /** Base currency + markup, so the preview can predict the resulting landed cost per product. */
  settings: { baseCurrency: string; secondaryCurrency: string | null; markupPercent: number }
}

/** An earlier upload that looks like this one. Shown, never used to block — see lib/invoices/store.ts. */
export interface DuplicateWarning {
  shipmentId: string
  invoiceId: string
  reason: 'same_file' | 'same_invoice_number'
  supplierName: string | null
  invoiceNumber: string | null
  status: ShipmentStatus
  appliedAt: string | null
  createdAt: string
}
