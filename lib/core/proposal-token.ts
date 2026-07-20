import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

// Secure proposal public tokens. The RAW token exists only in the emailed link / public URL; the DB stores
// only its SHA-256 hash (proposals.public_token_hash). Lookups hash the incoming token and compare. Sending
// (or re-sending) rotates the hash; revoking sets public_token_revoked_at. Never log/persist the raw token.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateProposalToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url') // 256 bits, URL-safe
  return { token, hash: hashToken(token) }
}

// Constant-time hex compare (defence-in-depth; the unique index already scopes the lookup).
export function tokensMatch(rawToken: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(rawToken), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export const looksLikeToken = (v: string): boolean => /^[A-Za-z0-9_-]{40,64}$/.test(v)
