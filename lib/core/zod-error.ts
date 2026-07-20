import type { ZodError } from 'zod'

// Turn a Zod failure into a clear, field-specific message so the UI can surface the REAL reason (e.g. a
// too-long description) instead of a generic "Invalid payload" that hides the cause.
export function zodMessage(err: ZodError): string {
  const i = err.issues[0]
  if (!i) return 'Invalid input.'
  const field = i.path.join('.') || 'field'
  if (i.code === 'too_big' && 'maximum' in i && typeof i.maximum === 'number') return `${field} is too long (max ${i.maximum.toLocaleString()} characters).`
  if (i.code === 'invalid_format' || i.code === 'invalid_value') return `${field} is not valid.`
  return `${field}: ${i.message}`
}
