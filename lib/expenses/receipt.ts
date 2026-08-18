// THE RECEIPT FILE — WHAT IS ACCEPTED, AND WHY IT IS SHRUNK BEFORE IT IS SENT.
//
// Isomorphic. The picker, the downscaler and the route all read the same numbers, so a file cannot be
// accepted by one and refused by the next.
//
// ── THE BINDING LIMIT IS NOT OURS ───────────────────────────────────────────────────────────────
//
// The supplier-invoices bucket accepts 20 MB and the route would happily take it. The platform will
// not: Vercel refuses a request body over ~4.5 MB AT THE EDGE, before the route exists as far as the
// application is concerned. Already recorded for supplier invoices in lib/invoices/OUTSTANDING.md §8.
//
// Receipts hit it far more often than supplier invoices do, because a supplier invoice is usually a
// PDF somebody emailed and a receipt is a photo somebody just took. A modern phone camera produces
// 3–6 MB per shot, so this is not an edge case — it is most of the traffic. Waiting for the first
// complaint would mean the failure mode ships: an upload that dies at the edge produces plain text
// where the client expected JSON, so without care it reads as "something went wrong" rather than
// "your photo is too big".
//
// Hence the downscale, in the first version. A receipt does not need to be a 12-megapixel photograph:
// it needs to be legible to a person and producible to an auditor, and 2000px on the long edge is both
// with room to spare.

/**
 * What the route accepts, and what the picker enforces.
 *
 * Below the platform's ~4.5 MB, with room for the form fields and multipart boundaries that share the
 * body. A PDF over this is REFUSED rather than shrunk — there is no lossless way to shrink one here,
 * and a silently re-rendered document is not the document somebody was handed.
 */
export const RECEIPT_MAX_BYTES = 3.5 * 1024 * 1024

/** Long edge after downscaling. A till receipt at 2000px is comfortably readable. */
export const RECEIPT_LONG_EDGE = 2000

/** JPEG quality. High enough that small print survives, low enough to land well under the ceiling. */
export const RECEIPT_QUALITY = 0.82

/**
 * Anything larger than this gets redrawn even if it would have fitted.
 *
 * Not the same number as RECEIPT_MAX_BYTES on purpose: a 3 MB photo is under the ceiling and still
 * pointless to store and re-serve at full size, and shrinking on the way in is free where shrinking
 * afterwards is a migration.
 */
export const RECEIPT_DOWNSCALE_OVER_BYTES = 900 * 1024

/**
 * HEIC IS HERE, and it is the one entry that needs explaining.
 *
 * The bucket does not accept image/heic and neither does anything that would ever read one. It is
 * accepted at the picker because the downscale REDRAWS it as JPEG, so what reaches the route is a
 * JPEG regardless of what came off the phone. On a browser that cannot decode HEIC the redraw fails
 * and says so in words — which is still better than the alternative, where iPhone owners find their
 * default camera format silently rejected.
 */
export const RECEIPT_EXTENSIONS: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
}

export const RECEIPT_ACCEPT_ATTR = Object.keys(RECEIPT_EXTENSIONS).map((e) => `.${e}`).join(',')

/** What the bucket will actually hold. Everything else must be redrawn into one of these first. */
export const RECEIPT_STORED_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])

export const receiptExtensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

export const isReceiptImage = (name: string): boolean => {
  const mime = RECEIPT_EXTENSIONS[receiptExtensionOf(name)]
  return !!mime && mime !== 'application/pdf'
}

/** True when this file should go through the canvas before being sent. */
export const shouldDownscale = (name: string, size: number): boolean =>
  isReceiptImage(name) && size > RECEIPT_DOWNSCALE_OVER_BYTES

/**
 * The size to redraw at, preserving aspect ratio and never ENLARGING.
 *
 * A 900px receipt scaled up to 2000px would be a bigger file carrying no more detail, which is the
 * opposite of the point.
 */
export function fittedSize(width: number, height: number, longEdge = RECEIPT_LONG_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= longEdge || longest === 0) return { width, height }
  const scale = longEdge / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * What is to happen to the receipt already on a row.
 *
 * Three cases and not two, because "no new file in this request" and "take the old one off" are
 * different intents that a nullable File cannot tell apart — and guessing wrong deletes proof
 * somebody meant to keep, silently, on a screen they opened to fix a typo in a merchant name.
 */
export type ReceiptChange =
  | { kind: 'keep' }
  | { kind: 'remove' }
  | { kind: 'replace'; file: File }

/**
 * Read that intent off a submitted form.
 *
 * Isomorphic and pure so it can be tested, because every wrong answer here is destructive and none of
 * them raise an error. The rule the tests pin: **anything ambiguous means keep.** A 'replace' that
 * arrives without a file is a client that lost the file between picking and sending — not an
 * instruction to clear the one already there — and an action word this function does not recognise is
 * a version skew, not permission to delete.
 */
export function receiptChangeFrom(action: unknown, file: File | null): ReceiptChange {
  if (action === 'remove') return { kind: 'remove' }
  if (action === 'replace' && file) return { kind: 'replace', file }
  return { kind: 'keep' }
}

/**
 * Why a file was refused, phrased for the person holding it.
 *
 * Checked AFTER the downscale, on what is actually about to be sent — checking the original would
 * refuse a 6 MB photo that was seconds away from becoming a 500 KB one.
 */
export function receiptFileError(fileName: string, size: number): string | null {
  const ext = receiptExtensionOf(fileName)
  if (!RECEIPT_EXTENSIONS[ext]) {
    return `Can't attach a .${ext || 'unknown'} file. A photo (JPG, PNG, HEIC) or a PDF works.`
  }
  if (size > RECEIPT_MAX_BYTES) {
    const mb = (size / 1024 / 1024).toFixed(1)
    return ext === 'pdf'
      ? `That PDF is ${mb} MB — the limit is ${(RECEIPT_MAX_BYTES / 1024 / 1024).toFixed(1)} MB. A photo of the receipt is usually much smaller.`
      : `That photo is still ${mb} MB after shrinking — the limit is ${(RECEIPT_MAX_BYTES / 1024 / 1024).toFixed(1)} MB.`
  }
  return null
}
