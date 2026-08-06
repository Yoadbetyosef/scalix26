import { describe, it, expect } from 'vitest'
import { groupProducts, clusterByStem, pickAxis, speakableAnswer, tokenize, type Groupable } from './grouping'

// Built from the real naturesparkle.com catalogue, because the shape of that data is the whole
// problem: a caller asks for "the emerald cut halo ring" and 30 rows come back spanning $369–$2,349,
// varying by metal AND setting at once.

const p = (title: string, price: number | null, extra: Partial<Groupable> = {}): Groupable => ({
  id: title, title, price, currency: 'USD', sku: null, availability: null,
  productUrl: `https://shop.example.com/${title.replace(/\s+/g, '-').toLowerCase()}`,
  imageUrl: null, source: 'website', ...extra,
})

const EMERALD_HALO = [
  p('Emerald Cut Diamond Hidden Halo Engagement Ring in Platinum with Round Shared Prong Pavé', 1769),
  p('Emerald Cut Diamond Hidden Halo Engagement Ring in Rose gold with Round Shared Prong Pavé', 1039),
  p('Emerald Cut Diamond Hidden Halo Engagement Ring in Silver with Round Shared Prong Pavé', 439),
  p('Emerald Cut Diamond Hidden Halo Engagement Ring in White gold with Round Shared Prong Pavé', 1039),
]

describe('clustering near-identical titles', () => {
  it('collapses a template family into one cluster', () => {
    const clusters = clusterByStem(EMERALD_HALO)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].members).toHaveLength(4)
  })

  it('keeps genuinely different products apart', () => {
    const clusters = clusterByStem([
      ...EMERALD_HALO,
      p('Round Cut Diamond Solitaire Ring in Platinum', 799),
      p('Kwikset 660 Single Cylinder Deadbolt', 34.99),
    ])
    expect(clusters.length).toBe(3)
  })

  it('does not cluster on a single shared word', () => {
    // "Ring" alone must not merge a $34 deadbolt ring with a $1,769 engagement ring.
    const clusters = clusterByStem([p('Brass Split Ring', 4), p('Emerald Ring in Platinum', 1769)])
    expect(clusters).toHaveLength(2)
  })
})

describe('choosing the axis to ask about', () => {
  it('picks the attribute that moves the price', () => {
    // Metal takes this ring from $439 to $1,769; the setting is identical across all four.
    const { axis, values } = pickAxis(EMERALD_HALO)
    expect(axis).toBe('metal')
    expect(values[0]).toBe('silver')                    // cheapest first, so the agent can offer real choices
    expect(values).toContain('platinum')
  })

  it('names no axis when the price barely moves', () => {
    // Nothing to ask about: quoting the range IS the answer.
    const flat = [p('Steel Hinge in Black', 12), p('Steel Hinge in White', 12.5)]
    expect(pickAxis(flat).axis).toBeNull()
  })

  it('names no axis when nothing in the vocabulary varies', () => {
    const opaque = [
      p('Widget Assembly Type A with Gallery', 100),
      p('Widget Assembly Type B with Scroll', 400),
    ]
    expect(pickAxis(opaque).axis).toBeNull()
  })
})

describe('the answer object', () => {
  it('turns 4 rows into one group carrying a range', () => {
    const [g] = groupProducts(EMERALD_HALO)
    expect(g.count).toBe(4)
    expect(g.priceMin).toBe(439)
    expect(g.priceMax).toBe(1769)
    expect(g.axis).toBe('metal')
    expect(g.label).toMatch(/^Emerald Cut Diamond Hidden Halo Engagement Ring/)
    expect(g.label).not.toMatch(/\bin$/)               // never a trailing connective
  })

  it('is speakable as a range and a question', () => {
    expect(speakableAnswer(groupProducts(EMERALD_HALO)[0]))
      .toBe('The Emerald Cut Diamond Hidden Halo Engagement Ring runs from $439 to $1,769 depending on the metal. Which one were you looking at?')
  })

  it('falls back to a good answer when the vocabulary misses', () => {
    // The case the dictionary will keep missing — and the sentence still works.
    const said = speakableAnswer(groupProducts([
      p('Widget Assembly Type A with Gallery', 439),
      p('Widget Assembly Type B with Scroll', 1769),
    ])[0])
    expect(said).toContain('a few versions')
    expect(said).toContain('$439')
    expect(said).toContain('$1,769')
    expect(said).not.toContain('undefined')
    expect(said).not.toContain('null')
  })

  it('states one price when there is only one product', () => {
    const [g] = groupProducts([p('Kwikset 660 Single Cylinder Deadbolt', 34.99, { sku: 'KW-660' })])
    expect(g.count).toBe(1)
    expect(g.sku).toBe('KW-660')
    expect(speakableAnswer(g)).toBe('The Kwikset 660 Single Cylinder Deadbolt is $34.99.')
  })

  it('never invents a price it does not have', () => {
    const [g] = groupProducts([p('Custom Order Ring', null)])
    expect(g.priceMin).toBeNull()
    expect(speakableAnswer(g)).toContain("don't have a price")
  })

  it('reports a cluster as in stock when any member is', () => {
    const [g] = groupProducts([
      p('Single Cylinder Deadbolt in Brass', 30, { availability: 'out_of_stock' }),
      p('Single Cylinder Deadbolt in Chrome', 32, { availability: 'in_stock' }),
    ])
    expect(g.availability).toBe('in_stock')
  })

  it('marks a group that came from both catalogs', () => {
    const [g] = groupProducts([
      p('Single Cylinder Deadbolt in Brass', 30, { source: 'inventory' }),
      p('Single Cylinder Deadbolt in Chrome', 32, { source: 'website' }),
    ])
    expect(g.source).toBe('both')
  })
})

describe('tokenizing what a caller says', () => {
  it('drops filler that carries no signal', () => {
    expect(tokenize('how much is the emerald cut halo ring'))
      .toEqual(['emerald', 'cut', 'halo', 'ring'])
  })

  it('keeps words that look like filler but are the answer', () => {
    // "gold" and "small" must survive — they are frequently the entire distinguishing attribute.
    expect(tokenize('small gold ring')).toEqual(['small', 'gold', 'ring'])
  })

  it('keeps model numbers intact', () => {
    expect(tokenize('do you have the Kwikset 660')).toEqual(['kwikset', '660'])
  })
})
