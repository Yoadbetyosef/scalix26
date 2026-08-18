// REDRAWING A PHONE PHOTO SMALL ENOUGH TO SEND. Browser only.
//
// Separate from receipt.ts because that file is isomorphic and the route imports it; this one touches
// createImageBitmap and canvas, which exist in exactly one of the two places.
//
// The decision of WHETHER to redraw lives in receipt.ts (`shouldDownscale`) so it can be tested
// without a DOM. This file only performs it.
//
// ── TWO COPIES, TWO SIZES, ONE DECODE ───────────────────────────────────────────────────────────
//
// The photograph is sent twice, at different moments and for different jobs: a 2000px copy at SAVE
// to be kept as proof, and a 1600px copy at PICK for the model to read. Both come from ONE
// createImageBitmap of the original — decoding a 12-megapixel HEIC is the expensive part, and doing
// it twice would put the cost in the moment the person is waiting.

import {
  RECEIPT_LONG_EDGE, RECEIPT_READ_LONG_EDGE, RECEIPT_QUALITY,
  fittedSize, isReceiptImage, shouldDownscale,
} from './receipt'

/** True when this browser can redraw at all. HEIC on Chrome fails inside createImageBitmap, not here. */
const canRedraw = () => typeof createImageBitmap === 'function' && typeof document !== 'undefined'

/**
 * One redraw of an already-decoded bitmap, at a given long edge. Null when the canvas will not.
 *
 * Never ENLARGES — fittedSize returns the original dimensions when they already fit, so a 900px
 * receipt is re-encoded at 900px rather than blown up into a bigger file carrying no more detail.
 */
async function redraw(bitmap: ImageBitmap, name: string, longEdge: number, lastModified: number): Promise<File | null> {
  const { width, height } = fittedSize(bitmap.width, bitmap.height, longEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // White underneath, because a PNG receipt with transparency flattened onto a JPEG's default black
  // is a black rectangle with black text on it.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', RECEIPT_QUALITY)
  })
  if (!blob) return null

  return new File([blob], jpegName(name), { type: 'image/jpeg', lastModified })
}

/** Both copies of one photograph. `read` is null when there is nothing smaller worth sending. */
export interface PreparedReceipt {
  /** What gets stored, and what the size check runs against. */
  stored: File
  /** What goes to the model — smaller, and only when redrawing actually produced something smaller. */
  read: File | null
}

/**
 * Prepare one picked file: the copy to keep, and the copy to read.
 *
 * A PDF passes through untouched as both — there is no lossless way to shrink one here, and a
 * silently re-rendered document is not the document somebody was handed.
 *
 * A browser that cannot decode the file hands the original back as `stored` and null as `read`. That
 * is not an error: a HEIC on a browser without HEIC support fails to decode, and the honest thing is
 * to let `receiptFileError` refuse it in words the person can act on — rather than throwing something
 * about ImageBitmap at somebody holding a phone.
 */
export async function prepareReceipt(file: File): Promise<PreparedReceipt> {
  if (!isReceiptImage(file.name) || !canRedraw()) return { stored: file, read: null }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { stored: file, read: null }
  }

  try {
    // The stored copy only when it is worth it — see shouldDownscale. A small photo is kept exactly
    // as it arrived, because re-encoding it would lose detail for nothing.
    let stored = file
    if (shouldDownscale(file.name, file.size)) {
      const big = await redraw(bitmap, file.name, RECEIPT_LONG_EDGE, file.lastModified)
      // If redrawing somehow made it bigger — a small photo of a flat surface can compress worse as a
      // JPEG than as the PNG it arrived as — keep the original. Sending the larger of the two would
      // be the function doing the opposite of its job.
      if (big && big.size < file.size) stored = big
    }

    const small = await redraw(bitmap, file.name, RECEIPT_READ_LONG_EDGE, file.lastModified)
    // Only worth a second upload if it is actually smaller than what we would otherwise send.
    const read = small && small.size < stored.size ? small : null

    return { stored, read }
  } finally {
    bitmap.close()
  }
}

/**
 * The stored copy alone.
 *
 * Kept as its own name because that is what the size check and the attach control are about, and
 * because it is what this module did before there was a second copy.
 */
export async function downscaleReceipt(file: File): Promise<File> {
  return (await prepareReceipt(file)).stored
}

/** photo.HEIC → photo.jpg. The extension has to follow the bytes, or the route refuses its own output. */
export function jpegName(name: string): string {
  if (!isReceiptImage(name)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot === -1 ? name : name.slice(0, dot)
  return `${stem || 'receipt'}.jpg`
}
