import twilio from 'twilio'
import { createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

// Shared webhook authenticity helpers. Signature verification is the PRIMARY security layer for every
// public inbound webhook — a forged request must never be processed or persisted. All helpers are
// FAIL-CLOSED: a missing secret, missing header, or bad signature returns false.

// The exact public URL Twilio signed. Twilio signs the full URL it was configured to call, INCLUDING
// the query string (voice uses ?cid=&ai=), so we must reconstruct it from the forwarded host + path +
// search — never the internal host. Behind Vercel, x-forwarded-proto/host carry the public values.
export function publicUrl(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '') || 'https'
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host
  return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`
}

// Verify an inbound Twilio request via X-Twilio-Signature over the exact URL + POSTed form params.
export function verifyTwilio(req: NextRequest, params: Record<string, string>): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN
  const signature = req.headers.get('x-twilio-signature')
  if (!token || !signature) return false
  try {
    return twilio.validateRequest(token, signature, publicUrl(req), params)
  } catch {
    return false
  }
}

// Verify Meta (Instagram/Facebook) X-Hub-Signature-256: HMAC-SHA256 of the RAW body with the app
// secret, timing-safe compared. The raw body bytes must be exactly what Meta signed — never re-serialized.
export function verifyMetaSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET
  if (!secret || !header) return false
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Enforcement gate: reject a webhook whose signature didn't verify — on Preview and Production. A local
// bypass keeps `npm run dev` usable without provider secrets (Vercel Preview runs NODE_ENV=production,
// so forged requests ARE rejected there — matching the production gate).
export function shouldReject(valid: boolean): boolean {
  return !valid && process.env.NODE_ENV !== 'development'
}
