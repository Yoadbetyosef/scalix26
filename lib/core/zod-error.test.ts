import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { zodMessage } from './zod-error'

// The long-content root cause: routes returned a generic "Invalid payload" so the UI couldn't say WHY.
// zodMessage surfaces the specific field + limit so the user sees the real reason.
describe('zodMessage', () => {
  const schema = z.object({ description: z.string().max(10000), title: z.string().max(200) })
  it('reports a too-long field with its limit', () => {
    const r = schema.safeParse({ description: 'x'.repeat(10001), title: 'ok' })
    expect(r.success).toBe(false)
    if (!r.success) expect(zodMessage(r.error)).toMatch(/description is too long \(max 10,000 characters\)/)
  })
  it('never returns the opaque "Invalid payload"', () => {
    const r = schema.safeParse({ description: 5, title: 'ok' })
    if (!r.success) expect(zodMessage(r.error)).not.toBe('Invalid payload')
  })
})
