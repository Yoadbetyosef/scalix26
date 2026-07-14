import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

// Secure approval tokens. The RAW token exists only in the emailed link; the DB stores only its SHA-256 hash.
// Lookups hash the incoming token and compare. Never log or persist the raw token. Pure (server crypto).

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateApprovalToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url') // 256 bits, URL-safe
  return { token, hash: hashToken(token) }
}

// Constant-time compare of two hex hashes (defence-in-depth; the DB unique index already scopes the lookup).
export function tokensMatch(rawToken: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(rawToken), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

// A valid token is a base64url string of the expected length — cheap pre-check before any DB hit.
export const looksLikeToken = (v: string): boolean => /^[A-Za-z0-9_-]{40,64}$/.test(v)
