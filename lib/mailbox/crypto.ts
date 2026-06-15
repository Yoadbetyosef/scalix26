import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// AES-256-GCM encryption for OAuth tokens at rest.
// APP_ENCRYPTION_KEY must be a 32-byte key, supplied as 64 hex chars or base64.
// Stored format: base64(iv).base64(authTag).base64(ciphertext)

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY
  if (!raw) throw new Error('APP_ENCRYPTION_KEY is not set')
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must decode to 32 bytes (64 hex chars or base64)')
  return key
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('malformed ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}
