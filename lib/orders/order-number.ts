// Non-sequential public order reference (e.g. ORD-7F3K9Q2M). Crockford base32 (no ambiguous 0/O/1/I/L),
// derived from cryptographically random bytes — no sequential/guessable IDs. Pure (byte source injected).

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32

export function orderNumberFromBytes(bytes: Uint8Array, len = 8): string {
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i % bytes.length] % 32]
  return `ORD-${out}`
}

export function generateOrderNumber(len = 8): string {
  // Web Crypto is available globally on the Node server runtime (Node 18+) and in tests. Never Math.random.
  const bytes = new Uint8Array(len)
  globalThis.crypto.getRandomValues(bytes)
  return orderNumberFromBytes(bytes, len)
}
