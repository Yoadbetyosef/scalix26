// Order attachment rules — isomorphic, no server imports, so the upload UI can share exactly the limits
// the server enforces. (lib/orders/attachments.ts reaches next/headers and can never be imported by a
// client component.)

// Matches the order-attachments bucket's own file_size_limit, which is itself pinned to the Supabase
// project's global upload ceiling. Raising this without raising the bucket would only move the rejection
// from our error message to an opaque one from storage.
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
export const MAX_INVOICE_BYTES = 20 * 1024 * 1024

export const extensionOf = (fileName: string): string => {
  const i = fileName.lastIndexOf('.')
  return i > 0 ? fileName.slice(i + 1).toLowerCase() : ''
}
