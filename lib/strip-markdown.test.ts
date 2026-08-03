import { describe, it, expect } from 'vitest'
import { stripMarkdown } from './utils'

// stripMarkdown is the last line of defence on every plain-text channel — SMS, WhatsApp, email and,
// most consequentially, text-to-speech, where a surviving asterisk is pronounced "star star" to a
// customer on the phone. These cases are the ones that were actually observed or are a step away.

describe('stripMarkdown', () => {
  it('removes the bold that was being read aloud as "star star"', () => {
    expect(stripMarkdown('You have two sofas in stock: the **Albero** ($13,000) and the **Cavalo** ($8,000).'))
      .toBe('You have two sofas in stock: the Albero ($13,000) and the Cavalo ($8,000).')
  })

  it('removes an UNBALANCED emphasis marker, which pairing rules alone leave behind', () => {
    expect(stripMarkdown('The **Albero is ready')).toBe('The Albero is ready')
    expect(stripMarkdown('Ready *now')).toBe('Ready now')
  })

  it('reads a link as its label and never speaks the URL', () => {
    expect(stripMarkdown('See [the invoice](https://example.com/a/b?c=d) for details.'))
      .toBe('See the invoice for details.')
  })

  it('handles italics, strikethrough and code', () => {
    expect(stripMarkdown('That is *urgent*, ~~not~~ `optional`.')).toBe('That is urgent, not optional.')
  })

  it('flattens headings, bullets, numbered lists and quotes', () => {
    expect(stripMarkdown('# Today\n- one\n- two\n1. three\n> a note'))
      .toBe('Today\none\ntwo\nthree\na note')
  })

  it('leaves ordinary punctuation, prices and snake_case identifiers alone', () => {
    expect(stripMarkdown('Order ORD-8A65: $13,000 — due 2026-08-10 (deposit paid).'))
      .toBe('Order ORD-8A65: $13,000 — due 2026-08-10 (deposit paid).')
    expect(stripMarkdown('The field is stone_type on the line item.'))
      .toBe('The field is stone_type on the line item.')
  })

  it('is safe on empty and unformatted input', () => {
    expect(stripMarkdown('')).toBe('')
    expect(stripMarkdown('Plain sentence.')).toBe('Plain sentence.')
  })
})
