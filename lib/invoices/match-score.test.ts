import { describe, it, expect } from 'vitest'
import { bestMatch, normalizeSku, similarity, tokenize, NAME_THRESHOLD, type Candidate } from './match-score'

// A match decides which product's cost gets rewritten. The properties worth pinning are therefore
// mostly about REFUSING: the ladder must decline when it isn't sure, because a confident wrong match
// silently rewrites the landed cost of something that was never on the shipment.

const p = (id: string, name: string, sku: string | null = null): Candidate => ({ id, name, sku })

describe('SKU matching', () => {
  const cat = [p('1', 'Oak Dining Chair', 'TG-1042/B'), p('2', 'Marble Side Table', 'MST-90')]

  it('matches identical SKUs regardless of case', () => {
    expect(bestMatch({ sku: 'tg-1042/b', description: null }, cat))
      .toEqual({ productId: '1', method: 'exact_sku', confidence: 1 })
  })

  it('matches once punctuation stops counting, and says that is what it did', () => {
    // The supplier writes TG1042B, we hold TG-1042/B. Same product, different typing conventions.
    expect(bestMatch({ sku: 'TG1042B', description: null }, cat))
      .toEqual({ productId: '1', method: 'normalized_sku', confidence: 0.95 })
  })

  it('refuses when two products normalise to the same SKU', () => {
    // That is a catalogue problem. Guessing between them here would hide it.
    const dupes = [p('1', 'Chair A', 'TG-1042'), p('2', 'Chair B', 'TG1042')]
    expect(bestMatch({ sku: 'TG 1042', description: null }, dupes)).toBeNull()
  })

  it('does not normalise a SKU down to something too short to identify anything', () => {
    const short = [p('1', 'Thing', 'A-1')]
    expect(bestMatch({ sku: 'A/1', description: null }, short)).toBeNull()
  })

  it('normalizeSku strips the noise and keeps the signal', () => {
    expect(normalizeSku('tg-1042/b')).toBe('TG1042B')
    expect(normalizeSku('  MST . 90 ')).toBe('MST90')
  })
})

describe('name matching', () => {
  it('matches a description that is clearly the product', () => {
    const m = bestMatch({ sku: null, description: 'Marble Side Table' }, [p('1', 'Marble Side Table'), p('2', 'Oak Dining Chair')])
    expect(m?.productId).toBe('1')
    expect(m?.method).toBe('name_trigram')
    expect(m!.confidence).toBeGreaterThan(0.9)
  })

  it('refuses when nothing is close enough', () => {
    // An invoice line for something the business does not stock must stay unmatched, not attach itself
    // to the nearest thing in the catalogue.
    expect(bestMatch({ sku: null, description: 'Packing crate' }, [p('1', 'Marble Side Table')])).toBeNull()
  })

  it('refuses between two near-identical variants rather than tossing a coin', () => {
    // The single most likely way to write freight onto the wrong product.
    const variants = [p('1', 'Oak Dining Chair — Natural'), p('2', 'Oak Dining Chair — Walnut')]
    expect(bestMatch({ sku: null, description: 'Oak Dining Chair' }, variants)).toBeNull()
  })

  it('still matches when one variant is clearly the closer of the two', () => {
    const variants = [p('1', 'Oak Dining Chair — Natural'), p('2', 'Marble Side Table')]
    expect(bestMatch({ sku: null, description: 'Oak Dining Chair Natural' }, variants)?.productId).toBe('1')
  })

  it('reports the score as the confidence, so the screen can show its working', () => {
    const m = bestMatch({ sku: null, description: 'Marble Side Tables' }, [p('1', 'Marble Side Table')])
    expect(m!.confidence).toBeGreaterThanOrEqual(NAME_THRESHOLD)
    expect(m!.confidence).toBeLessThan(1)
  })
})

describe('the ladder prefers the rung it can justify', () => {
  it('takes an exact SKU over a better-looking name', () => {
    const cat = [p('1', 'Completely Different Label', 'MST-90'), p('2', 'Marble Side Table', 'OTHER')]
    expect(bestMatch({ sku: 'MST-90', description: 'Marble Side Table' }, cat)?.productId).toBe('1')
  })

  it('falls through to the name when the SKU matches nothing', () => {
    const cat = [p('1', 'Marble Side Table', 'MST-90')]
    expect(bestMatch({ sku: 'NOT-IN-CATALOGUE', description: 'Marble Side Table' }, cat)?.method).toBe('name_trigram')
  })

  it('returns nothing for a line with neither a SKU nor a description', () => {
    expect(bestMatch({ sku: null, description: null }, [p('1', 'Anything')])).toBeNull()
  })

  it('returns nothing against an empty catalogue', () => {
    expect(bestMatch({ sku: 'MST-90', description: 'Marble Side Table' }, [])).toBeNull()
  })
})

describe('scoring primitives', () => {
  it('scores identical strings at 1 and unrelated ones near 0', () => {
    expect(similarity('marble side table', 'marble side table')).toBe(1)
    expect(similarity('marble side table', 'packing crate')).toBeLessThan(0.15)
  })

  it('is symmetric, so match order cannot change the answer', () => {
    expect(similarity('oak chair', 'oak dining chair')).toBe(similarity('oak dining chair', 'oak chair'))
  })

  it('drops filler words and single characters from tokens', () => {
    // "2" and "x" go with "set" and "of": on an invoice line they are the quantity notation, not part
    // of what the thing is called. What survives is the phrase worth searching the catalogue for.
    expect(tokenize('Set of 2 x Oak Chairs, natural')).toEqual(['oak', 'chairs', 'natural'])
  })
})

// Measured on a real 133-line invoice: three lines with three DIFFERENT SKUs, none of them in the
// catalogue, all name-matched to one product at 0.72. Recorded as a characterisation test — it pins
// what the matcher does TODAY, which is not what it should do. See OUTSTANDING.md.
describe('the name rung fires even when a line SKU matched nothing (known, unfixed)', () => {
  const catalog = [p('P2', 'Linen Scatter Cushion 45x45', 'YDC-CUS-L45')]

  it('matches on description despite a SKU that identifies nothing', () => {
    const m = bestMatch({ sku: '1343095', description: 'SCATTER CUSHION 45X45' }, catalog)
    // The supplier told us their identifier and we do not hold it — evidence the product is absent.
    // The ladder treats it as no evidence at all and matches on shared trigrams instead.
    expect(m?.productId).toBe('P2')
    expect(m?.method).toBe('name_trigram')
  })

  it('sends three distinct products to the same row', () => {
    const ids = ['1343095', '1343109', '1343122']
      .map((sku) => bestMatch({ sku, description: 'SCATTER CUSHION 45X45' }, catalog)?.productId)
    expect(new Set(ids).size).toBe(1)   // three lines, one product — costs then average into one figure
  })
})
