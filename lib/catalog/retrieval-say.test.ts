import { describe, it, expect } from 'vitest'
import { timedOutSay, partialSay, noMatch } from './retrieval'
import type { ProductGroup } from './grouping'

// Three situations that used to produce one sentence. A caller heard "I'm not seeing it in the system"
// whether we had looked and found nothing, looked and run out of time, or found something adjacent —
// and neither the caller nor the owner could tell which had happened.

const g = (label: string): ProductGroup => ({
  label, count: 1, priceMin: null, priceMax: null, currency: 'USD', axis: null, axisValues: [],
  sku: null, availability: null, inStock: null, exampleUrl: null, source: 'inventory',
  notPricedCount: 1, notPricedValues: [],
})

describe('a timeout must not sound like a miss', () => {
  it('asserts nothing about whether we stock it', () => {
    const say = timedOutSay()
    // A miss claims knowledge — "we don't have it". A timeout has none. These are the words that
    // would be a lie after a timeout.
    expect(say).not.toMatch(/don't see|not seeing|don't have|not in (our|the)/i)
    expect(say).not.toMatch(/catalog/i)
  })

  it('says the lookup itself failed, and offers a way forward', () => {
    expect(timedOutSay()).toMatch(/taking longer/i)
    expect(timedOutSay(true)).toMatch(/put you through/)
    expect(timedOutSay(false)).toMatch(/take your number/)
  })

  it('is different from the miss sentence', () => {
    expect(timedOutSay()).not.toBe(noMatch('raja sofa'))
  })
})

describe('a partial match asks rather than refuses', () => {
  it('names what we do have and makes it a question', () => {
    const say = partialSay('raja sofa', [g('RAJA STOOL 135X85'), g('RAJA E CORNER'), g('RAJA 2,5 PL')])
    expect(say).toMatch(/RAJA STOOL 135X85/)
    expect(say).toMatch(/RAJA E CORNER/)
    expect(say).toMatch(/RAJA 2,5 PL/)
    expect(say).toMatch(/Did you mean one of those\?$/)
  })

  it('is honest that the exact thing was not found', () => {
    // It must not pretend "raja sofa" matched — it answered a narrower question on purpose.
    expect(partialSay('raja sofa', [g('RAJA STOOL')])).toMatch(/don't have an exact match for "raja sofa"/)
  })

  it('reads naturally for a single suggestion', () => {
    const say = partialSay('raja sofa', [g('RAJA 2,5 PL')])
    expect(say).toMatch(/we do have the RAJA 2,5 PL\./)
    expect(say).not.toMatch(/ and /)
  })

  it('would have rescued the call that prompted all of this', () => {
    // The caller wanted the 2.5-seater. The system had it and said no.
    expect(partialSay('RAJA sofa', [g('RAJA 2,5 PL'), g('RAJA STOOL 60X60')])).toMatch(/RAJA 2,5 PL/)
  })

  it('caps the list so the agent does not read a catalogue aloud', () => {
    const many = ['A', 'B', 'C', 'D', 'E'].map(g)
    const say = partialSay('x', many)
    expect(say).toMatch(/the A, the B and the C/)
    expect(say).not.toMatch(/\bD\b|\bE\b/)
  })
})
