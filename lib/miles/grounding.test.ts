import { describe, it, expect } from 'vitest'
import { groundedFor, terms } from './grounding'

// "Anything with no answer in the knowledge base" is a quarter of the autonomy rule, and the
// classifier refuses to guess it. This is where it is decided, so this is where it has to be right.

const kb = {
  knowledge: [
    'Ring resizing — we resize gold and platinum rings in house, usually while you wait.',
    'Engraving — hand engraving on the inside of a band, up to 20 characters.',
    'Repairs — chain soldering, clasp replacement, stone tightening.',
  ],
  facts: ['TG Jewellers', '14 Bond Street, Boston', 'Mon-Fri 9:00-17:00'],
}

describe('terms', () => {
  it('keeps what a question is about and drops what it is made of', () => {
    expect(terms('How much do you charge for ring resizing?')).toEqual(['charge', 'ring', 'resizing'])
  })

  it('is not fooled by punctuation or case', () => {
    expect(terms('RING, resizing... ring!')).toEqual(['ring', 'resizing'])
  })
})

describe('groundedFor', () => {
  it('is grounded when the business has written about it', () => {
    expect(groundedFor('Do you do ring resizing?', kb).grounded).toBe(true)
    expect(groundedFor('Can you engrave a band?', kb).grounded).toBe(true)
  })

  it('is NOT grounded when the question is about something nobody wrote down', () => {
    const g = groundedFor('Do you buy antique pocket watches?', kb)
    expect(g.grounded).toBe(false)
    expect(g.missing).toContain('watches')
  })

  it('is not grounded when there is nothing on file at all', () => {
    // A tenant with an empty knowledge base has told us nothing, so everything is improvised.
    expect(groundedFor('Do you do ring resizing?', { knowledge: [] }).grounded).toBe(false)
  })

  it('treats a message with no content words as ungrounded rather than as trivially answered', () => {
    // "hi there?" has nothing to answer. A reply to it is improvised by definition.
    expect(groundedFor('Hi there!', kb).grounded).toBe(false)
    expect(groundedFor('', kb).grounded).toBe(false)
  })

  it('does not clear a question on one incidental word', () => {
    // "ring" appears on file; buying one second-hand is not something anyone wrote about.
    const g = groundedFor('Will you buy my grandmother antique emerald ring collection?', kb)
    expect(g.grounded).toBe(false)
    expect(g.coverage).toBeLessThan(0.5)
  })

  it('answers the same way every time — no judgement, no variance', () => {
    const q = 'Do you resize platinum rings?'
    const a = groundedFor(q, kb)
    for (let i = 0; i < 5; i++) expect(groundedFor(q, kb)).toEqual(a)
  })

  it('counts the business’s own details, so hours and address are answerable', () => {
    expect(groundedFor('What are your hours on Bond Street?', kb).grounded).toBe(true)
  })
})
