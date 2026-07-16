import { createHmac, timingSafeEqual } from 'crypto'

// CSRF-safe OAuth `state`: a signed token binding the round-trip to the initiating tenant. The callback
// re-derives the signature and also checks the embedded tenantId against the authenticated session, so a
// forged or replayed state cannot connect QuickBooks to the wrong tenant. Signed with a key derived from
// APP_ENCRYPTION_KEY (no new secret to manage); expires after 10 minutes.

const STATE_TTL_MS = 10 * 60 * 1000

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY
  if (!raw) throw new Error('APP_ENCRYPTION_KEY is not set')
  return /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const sign = (body: string) => b64url(createHmac('sha256', key()).update(body).update('qbo-oauth-state').digest())

export function signState(tenantId: string, nowMs: number): string {
  const body = b64url(Buffer.from(JSON.stringify({ t: tenantId, ts: nowMs })))
  return `${body}.${sign(body)}`
}

// Returns the embedded tenantId if the signature is valid and unexpired, else null.
export function verifyState(state: string | null | undefined, nowMs: number): string | null {
  if (!state || !state.includes('.')) return null
  const [body, sig] = state.split('.')
  const expected = sign(body)
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const { t, ts } = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    if (typeof t !== 'string' || typeof ts !== 'number') return null
    if (nowMs - ts > STATE_TTL_MS || nowMs - ts < -60_000) return null // expired or clock-skewed future
    return t
  } catch { return null }
}
