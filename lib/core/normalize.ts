// Deterministic normalization used for cross-channel identity + dedupe keys. Pure & unit-tested.
// Not a full libphonenumber — a stable canonical form good enough to key duplicates and channel identities.

export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw == null) return null
  let s = String(raw).trim()
  if (!s) return null
  // "00" international prefix → "+"
  if (s.startsWith('00')) s = '+' + s.slice(2)
  const hasPlus = s.startsWith('+')
  const digits = s.replace(/\D/g, '')
  if (digits.length < 7) return null
  return hasPlus ? '+' + digits : digits
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const e = String(raw).trim().toLowerCase()
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null
}

// Normalized external id for a given channel (phone-like channels vs email vs social id).
export function normalizeIdentity(channel: string, raw: string | null | undefined): string | null {
  if (raw == null) return null
  if (channel === 'email') return normalizeEmail(raw)
  if (channel === 'sms' || channel === 'whatsapp' || channel === 'voice') return normalizePhone(raw)
  const s = String(raw).trim()
  return s || null // instagram/facebook/webchat: opaque social id, trimmed
}
