// Non-sequential, human-readable, per-tenant unique reference numbers (uniqueness enforced by the DB
// unique index; on the astronomically rare collision the caller retries).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32 (no I,L,O,U)

function randomCode(len: number): string {
  const bytes = new Uint8Array(len)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % 32]
  return out
}

export const generateDraftNumber = (): string => `DRAFT-${randomCode(8)}`
export const generateProjectNumber = (): string => `PROJ-${randomCode(8)}`
export const reservationIdempotencyKey = (draftId: string, itemKind: string, itemId: string, locationId: string): string =>
  `res:${draftId}:${itemKind}:${itemId}:${locationId}`
