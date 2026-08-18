// REDRAWING A PHONE PHOTO SMALL ENOUGH TO SEND. Browser only.
//
// Separate from receipt.ts because that file is isomorphic and the route imports it; this one touches
// createImageBitmap and canvas, which exist in exactly one of the two places.
//
// The decision of WHETHER to redraw lives in receipt.ts (`shouldDownscale`) so it can be tested
// without a DOM. This file only performs it.

import {
  RECEIPT_LONG_EDGE, RECEIPT_QUALITY, fittedSize, isReceiptImage, shouldDownscale,
} from './receipt'

/**
 * A smaller JPEG of the same photograph, or the original file untouched.
 *
 * Untouched when it is a PDF, when it is already small, or when the browser cannot decode it. That
 * last case is not an error here: a HEIC on a browser without HEIC support fails to decode, and the
 * honest thing is to hand the original back and let `receiptFileError` refuse it in words the person
 * can act on — rather than throwing something about ImageBitmap at somebody holding a phone.
 */
export async function downscaleReceipt(file: File): Promise<File> {
  if (!shouldDownscale(file.name, file.size)) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }

  try {
    const { width, height } = fittedSize(bitmap.width, bitmap.height, RECEIPT_LONG_EDGE)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file

    // White underneath, because a PNG receipt with transparency flattened onto a JPEG's default black
    // is a black rectangle with black text on it.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', RECEIPT_QUALITY)
    })
    if (!blob) return file

    // If redrawing somehow made it bigger — a small photo of a flat surface can compress worse as a
    // JPEG than as the PNG it arrived as — keep the original. Sending the larger of the two would be
    // the function doing the opposite of its job.
    if (blob.size >= file.size) return file

    return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified })
  } finally {
    bitmap.close()
  }
}

/** photo.HEIC → photo.jpg. The extension has to follow the bytes, or the route refuses its own output. */
export function jpegName(name: string): string {
  if (!isReceiptImage(name)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot === -1 ? name : name.slice(0, dot)
  return `${stem || 'receipt'}.jpg`
}
