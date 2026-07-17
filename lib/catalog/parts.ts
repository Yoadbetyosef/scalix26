import type { NextRequest } from 'next/server'
import QRCode from 'qrcode'
import { AVAILABILITY_STATUSES } from './types'

// Whitelist + coerce incoming part fields (mirrors lib/catalog/sanitize.ts for products).
export function sanitizePart(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (typeof body.name === 'string') out.name = body.name.trim().slice(0, 200)
  if (body.image_url === null || typeof body.image_url === 'string') out.image_url = body.image_url ? String(body.image_url).trim().slice(0, 2000) : null
  if (body.price === null || body.price === '' || typeof body.price === 'number' || typeof body.price === 'string') {
    const n = body.price === null || body.price === '' ? null : Number(body.price)
    out.price = n === null || Number.isNaN(n) ? null : n
  }
  if (typeof body.availability_status === 'string' && (AVAILABILITY_STATUSES as readonly string[]).includes(body.availability_status)) out.availability_status = body.availability_status
  if (body.quantity !== undefined) { const q = Number(body.quantity); out.quantity = Number.isFinite(q) ? Math.max(0, Math.trunc(q)) : 0 }
  if (body.sort_order !== undefined) { const s = Number(body.sort_order); out.sort_order = Number.isFinite(s) ? Math.trunc(s) : 0 }
  if (body.notes === null || typeof body.notes === 'string') out.notes = body.notes ? String(body.notes).slice(0, 2000) : null
  return out
}

// Prefer the configured app URL; fall back to the request's own origin so a part's QR is always an
// absolute, scannable URL even when NEXT_PUBLIC_APP_URL is unset.
export const appBase = (req: NextRequest): string => process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin

export async function withQr<T extends { qr_code_token: string }>(part: T, base: string): Promise<T & { qr: { target: string; dataUrl: string | null } }> {
  const target = `${base}/q/${part.qr_code_token}`
  let dataUrl: string | null = null
  try { dataUrl = await QRCode.toDataURL(target, { margin: 1, width: 240 }) } catch { /* non-fatal */ }
  return { ...part, qr: { target, dataUrl } }
}
