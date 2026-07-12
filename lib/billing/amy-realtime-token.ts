import { createHmac, timingSafeEqual } from 'crypto'

// Short-lived HMAC bearer that authorizes ONE Ask Amy realtime voice session. It is minted ONLY by the
// authenticated, billing-gated /api/ai/amy/realtime-auth route (after assertPartnerActive passes) and
// verified by amy-realtime-server BEFORE it configures the billable Deepgram Voice Agent. So a paused
// White Label partner can never open a realtime session: the route returns 402 (no token), and even a
// hand-crafted client can't produce a valid signature without AMY_REALTIME_SECRET.
//
// Format (KEEP IDENTICAL to amy-realtime-server/server.js verifyToken): `<payloadB64url>.<sigB64url>`,
// payload = JSON {t: tenantId, exp: epochSeconds}, sig = HMAC-SHA256(payloadB64url, AMY_REALTIME_SECRET).
// Inert until AMY_REALTIME_SECRET is set on BOTH the app and the proxy — until then mint returns null and
// the proxy skips verification (backward-compatible rollout, like the other WL flags).

const TTL_SECONDS = 120

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function mintAmyRealtimeToken(tenantId: string, nowMs: number = Date.now()): string | null {
  const secret = process.env.AMY_REALTIME_SECRET
  if (!secret) return null
  const payload = b64url(Buffer.from(JSON.stringify({ t: tenantId, exp: Math.floor(nowMs / 1000) + TTL_SECONDS })))
  const sig = b64url(createHmac('sha256', secret).update(payload).digest())
  return `${payload}.${sig}`
}

export interface AmyTokenResult { ok: boolean; tenantId?: string; reason?: string }

export function verifyAmyRealtimeToken(token: string | undefined | null, nowMs: number = Date.now()): AmyTokenResult {
  const secret = process.env.AMY_REALTIME_SECRET
  if (!secret) return { ok: false, reason: 'no_secret' }
  if (!token || !token.includes('.')) return { ok: false, reason: 'malformed' }
  const [payload, sig] = token.split('.')
  const expected = b64url(createHmac('sha256', secret).update(payload).digest())
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_sig' }
  let data: { t?: string; exp?: number }
  try { data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()) }
  catch { return { ok: false, reason: 'bad_payload' } }
  if (!data.exp || data.exp * 1000 < nowMs) return { ok: false, reason: 'expired' }
  return { ok: true, tenantId: data.t }
}
