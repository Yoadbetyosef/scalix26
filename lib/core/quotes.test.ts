import { describe, it, expect } from 'vitest'
import { quoteState } from './quotes'

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

describe('the four states of a quote', () => {
  it('never sent is a draft, whatever its date', () => {
    expect(quoteState({ status: 'draft', sent_at: null, valid_until: day(-5) })).toBe('draft')
  })
  it('sent and still open is waiting — with a date ahead, today, or none at all', () => {
    expect(quoteState({ status: 'draft', sent_at: '2026-11-01T00:00:00Z', valid_until: day(3) })).toBe('waiting')
    expect(quoteState({ status: 'draft', sent_at: '2026-11-01T00:00:00Z', valid_until: day(0) })).toBe('waiting')
    expect(quoteState({ status: 'draft', sent_at: '2026-11-01T00:00:00Z', valid_until: null })).toBe('waiting')
  })
  it('sent and past its date is expired', () => {
    expect(quoteState({ status: 'draft', sent_at: '2026-11-01T00:00:00Z', valid_until: day(-1) })).toBe('expired')
  })
  it('accepted outranks an old date', () => {
    expect(quoteState({ status: 'accepted', sent_at: '2026-11-01T00:00:00Z', valid_until: day(-30) })).toBe('accepted')
  })
})
