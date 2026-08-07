import { describe, it, expect } from 'vitest'
import { distinctiveTerms, planKeyterms, termsIn, KEYTERM_WORD_BUDGET, MIN_KEYTERM_COVERAGE } from './terms'

// Built from the real Primavera catalogue, because the whole point is which of these words a general
// English speech model will and will not produce. It produced "Vaja", "Roger Solphine" and "Rosa raja"
// for "RAJA" across two calls; it has never had trouble with "sofa".

const YDC = [
  'RAJA E CORNER', 'RAJA TERMINAL MAX R', 'RAJA 2,5 PL',
  'RAJA STOOL 60X60', 'RAJA STOOL 135X85', 'RAJA STOOL 80X50',
  'CAVALLO 4-Seat sofa', 'NOMARO 3 ARM SOFA', 'JASIEK CORNER',
  'Marble Console Top', 'Linen Scatter Cushion 45x45', 'Albero Side Table — Oak',
]

describe('separating the catalogue\'s words from the language\'s', () => {
  const terms = distinctiveTerms(YDC).map((t) => t.term)

  it('keeps the names a speech model will never guess', () => {
    expect(terms).toContain('raja')
    expect(terms).toContain('cavallo')
    expect(terms).toContain('nomaro')
    expect(terms).toContain('jasiek')
    expect(terms).toContain('albero')
  })

  it('drops the words it already gets right', () => {
    // Boosting these would spend slots teaching Deepgram English.
    for (const w of ['sofa', 'stool', 'table', 'corner', 'oak', 'marble', 'linen', 'cushion', 'console', 'seat']) {
      expect(terms).not.toContain(w)
    }
  })

  it('drops dimensions and article numbers', () => {
    // "135x85" is not a word anyone says, and boosting it helps nobody.
    expect(terms.some((t) => /\d/.test(t))).toBe(false)
  })

  it('ranks by how many products carry the name', () => {
    // At the cap, a name on eight products is worth more than a name on one.
    const ranked = distinctiveTerms(YDC)
    expect(ranked[0].term).toBe('raja')
    expect(ranked[0].products).toBe(6)
  })

  it('counts a product once even if the word repeats in its title', () => {
    expect(distinctiveTerms(['RAJA RAJA RAJA'])[0].products).toBe(1)
  })

  it('gives the same list twice for the same catalogue', () => {
    // A keyterm set that reshuffles between calls makes any measurement of its effect meaningless.
    expect(distinctiveTerms(YDC)).toEqual(distinctiveTerms([...YDC].reverse()))
  })
})

describe('the 500-token cap — the thing to design around', () => {
  it('sends everything when it fits', () => {
    const p = planKeyterms(YDC)
    expect(p.state).toBe('ok')
    expect(p.dropped).toBe(0)
    expect(p.keyterms).toContain('raja')
    // 11 of 12, not all of them: "Marble Console Top" is three ordinary English words, so it has
    // nothing to boost and is legitimately uncovered. Coverage measures products we can HELP, and a
    // product the model already transcribes correctly is not a gap.
    expect(p.coverage).toBeCloseTo(11 / 12, 5)
  })

  it('truncates to the most-used terms and says how many were dropped', () => {
    // One shared name across many products, plus a long tail of one-offs.
    const many = [
      ...Array.from({ length: 40 }, (_, i) => `RAJA VARIANT${i} SOFA`),
      ...Array.from({ length: KEYTERM_WORD_BUDGET + 60 }, (_, i) => `RAJA UNIQUEWORD${i}X SOFA`),
    ]
    const p = planKeyterms(many)
    expect(p.state).toBe('truncated')
    expect(p.keyterms.length).toBe(KEYTERM_WORD_BUDGET)
    expect(p.dropped).toBeGreaterThan(0)
    // 'raja' is on every product, so it must survive the cap — that is what ranking by count buys.
    expect(p.keyterms).toContain('raja')
  })

  it('DISABLES itself rather than boosting a sliver of a large catalogue', () => {
    // 9,179 products with no shared vocabulary: 350 slots would cover a few percent, every other
    // product stays exactly as broken, and the feature reads as configured. Saying nothing is
    // honest; saying "on" while doing nothing is the failure being designed against.
    const huge = Array.from({ length: 5000 }, (_, i) => `UNIQUEBRAND${i} SOFA`)
    const p = planKeyterms(huge)
    expect(p.state).toBe('disabled')
    expect(p.keyterms).toEqual([])
    expect(p.coverage).toBeLessThan(MIN_KEYTERM_COVERAGE)
    // The numbers are still reported, so the screen can explain WHY rather than just showing "off".
    expect(p.found).toBeGreaterThan(KEYTERM_WORD_BUDGET)
    expect(p.totalProducts).toBe(5000)
  })

  it('stays enabled for a large catalogue that shares its vocabulary', () => {
    // Size alone is not the disqualifier — coverage is. 5,000 products under 40 brand names is
    // perfectly boostable.
    const shared = Array.from({ length: 5000 }, (_, i) => `BRANDNAME${i % 40} SOFA`)
    const p = planKeyterms(shared)
    expect(p.state).toBe('ok')
    expect(p.coverage).toBe(1)
  })

  it('is disabled, not crashing, on an empty catalogue', () => {
    const p = planKeyterms([])
    expect(p.state).toBe('disabled')
    expect(p.keyterms).toEqual([])
    expect(p.coverage).toBe(0)
  })

  it('is disabled when a catalogue is nothing but ordinary English', () => {
    // Nothing to teach: boosting "sofa" and "table" would spend the budget on words the model has.
    const p = planKeyterms(['Oak Dining Table', 'Linen Sofa', 'Marble Console'])
    expect(p.state).toBe('disabled')
    expect(p.found).toBe(0)
  })
})

describe('tokenizing a product name', () => {
  it('keeps short proper nouns', () => {
    // The grouping tokenizer drops 2-character tokens; here a short name is the whole point.
    expect(termsIn('KO Chair')).toContain('ko')
  })

  it('splits on punctuation and case-folds', () => {
    expect(termsIn('Albero Side Table — Oak')).toEqual(['albero', 'side', 'table', 'oak'])
  })
})
