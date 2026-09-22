import QRCode from 'qrcode'

/**
 * The absolute, public, customer-facing URL a product/sub-product QR encodes.
 *
 * `origin` is the request's own origin and is a REAL fallback, not decoration: every caller used to
 * build this as `${process.env.NEXT_PUBLIC_APP_URL || ''}/p/${token}`, so in any environment where
 * that variable is unset the QR encoded the bare path `/p/<token>` — a string no phone camera can
 * open, printed onto a label and glued to a piece of furniture. The same fallback is already what
 * app/api/admin/impersonate/route.ts does for its magic link.
 *
 * NOTE the token is the whole credential and the whole identity. This never takes a product id, so
 * editing price/description/photos cannot change the URL: the printed QR keeps resolving to the same
 * product and shows whatever was last saved.
 */
export function publicProductUrl(token: string, origin?: string | null): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || origin || '').replace(/\/+$/, '')
  return `${base}/p/${token}`
}

/** A PNG data URL for that link, or null — a QR we cannot draw must never fail the page around it. */
export async function qrDataUrl(target: string, width = 240): Promise<string | null> {
  try { return await QRCode.toDataURL(target, { margin: 1, width }) } catch { return null }
}
