// Order attachment rules — isomorphic, no server imports, so the upload UI can share exactly the limits
// the server enforces. (lib/orders/attachments.ts reaches next/headers and can never be imported by a
// client component.)

// Matches the order-attachments bucket's own file_size_limit, which is itself pinned to the Supabase
// project's global upload ceiling. Raising this without raising the bucket would only move the rejection
// from our error message to an opaque one from storage.
// UNREACHABLE ABOVE MAX_REQUEST_BODY_BYTES (~4.5 MB) — see below. Order attachments accept CAD, video
// and archives, which genuinely exceed that, so this number is NOT lowered to match the platform: doing
// so would disable the feature rather than fix it. The honest fix is a direct-to-storage signed upload
// that never passes through a function. Until then, a 12 MB .blend fails at the edge — now with a
// sentence rather than a JSON parse error, but it still fails. Logged in lib/invoices/OUTSTANDING.md §8.
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

// Custom jewelry work arrives as sketches, reference photos, CAD renders and video, so the allowlist is
// keyed on the file EXTENSION rather than the browser-reported MIME type: CAD formats have no registered
// type and arrive as application/octet-stream, indistinguishable from anything else by type alone.
//
// Each entry maps to the content type the file is STORED with. Nothing here renders as markup — .html and
// .svg are deliberately absent, so a stored file can never execute script against the storage origin.
// Formats with no safe renderable type are stored as octet-stream, which downloads instead of rendering.
const OCTET = 'application/octet-stream'
export const ALLOWED_EXTENSIONS: Record<string, string> = {
  // Images — heic/heif included, that's what an iPhone photo actually is
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp',
  // Documents
  pdf: 'application/pdf',
  // Video
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v',
  // CAD / 3D renders and the archives they're delivered in
  stl: OCTET, obj: OCTET, '3dm': OCTET, '3mf': OCTET, step: OCTET, stp: OCTET, iges: OCTET, igs: OCTET,
  dxf: OCTET, dwg: OCTET, blend: OCTET, gltf: OCTET, glb: OCTET, zip: 'application/zip',
}

// Ready for an <input type="file"> accept attribute.
export const ACCEPT_ATTR = Object.keys(ALLOWED_EXTENSIONS).map((e) => `.${e}`).join(',')

// The PUBLIC factory hand-off (token is the only credential) stays deliberately narrow: an invoice is a
// document or a photo of one. It does not inherit the wide CAD/video allowlist above.
export const INVOICE_EXTENSIONS: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
}
/**
 * The largest request body a Vercel function on this project will receive.
 *
 * MEASURED, not read off a doc page, on 7 Aug 2026 against the production deployment: 4,400,000 bytes
 * reached the app (307 from middleware), 4,500,000 came back 413 `FUNCTION_PAYLOAD_TOO_LARGE` from the
 * edge. The rejection happens BEFORE routing, auth or any handler — so no code in this repository can
 * catch it, log it, or turn it into a sentence. It arrives at the browser as the plain text
 * "Request Entity Too Large", which is not JSON.
 *
 * Vercel has announced 100 MB bodies on Fluid Compute. This project does not have it: the number above
 * is what the deployment actually does today. If that changes, re-measure — do not raise this because
 * a changelog says so.
 *
 * Every upload in this app streams its bytes through a function (there is no direct-to-storage signed
 * upload anywhere), so this ceiling applies to all of them.
 */
export const MAX_REQUEST_BODY_BYTES = 4_500_000

/**
 * What an upload may actually be.
 *
 * 4 MB rather than the platform's 4.5: multipart/form-data adds a boundary, part headers and the
 * filename around the bytes, and a file sized exactly at the ceiling would fail after the user picked
 * it. The margin is small on purpose — it is overhead, not a safety blanket.
 *
 * ── THIS WAS 20 MB, AND THAT WAS A PROMISE THE PLATFORM DOES NOT KEEP ───────────────────────────────
 *
 * A 6 MB invoice passed `invoiceFileError` at the file picker, uploaded, and died at the edge with a
 * message no part of this codebase wrote. The check said yes and the platform said no, which is worse
 * than a low limit honestly stated: the person had already waited for the upload.
 *
 * Both consumers were affected — the owner-facing supplier-invoice upload and the PUBLIC factory
 * hand-off in lib/orders/approvals.ts, where the person hitting it is a supplier with no support
 * channel and a token for a URL.
 *
 * If real invoices genuinely exceed this, the fix is a direct-to-storage signed upload that never
 * passes through a function — not a higher number here, which the edge will keep ignoring.
 */
export const MAX_INVOICE_BYTES = 4 * 1024 * 1024

export const extensionOf = (fileName: string): string => {
  const i = fileName.lastIndexOf('.')
  return i > 0 ? fileName.slice(i + 1).toLowerCase() : ''
}
