// Which words in a catalogue are the business's own, and which are ordinary English.
//
// PURE and ISOMORPHIC — no database, no network. One computation with two consumers:
//
//   1. KEYTERMS for speech-to-text. A general English model will never produce "RAJA" or "JASIEK" on
//      its own; it produces "Vaja", "Roger", "Rosa". Telling Deepgram those words exist is the only
//      repair that works at the source. It has no reason to be told about "sofa".
//
//   2. RUNG ORDERING in lib/catalog/retrieval.ts (see catalog-worker/OUTSTANDING.md §1b). When the
//      ladder drops a token it currently keeps the LONGEST, which is not a proxy for anything — it
//      kept "rosa" over "raja" because both are four letters. The token that matches products is the
//      one to keep, and that is this same question asked the other way round.
//
// Written once because it IS one question: is this word the catalogue's, or the language's.

/**
 * Words a general speech model already gets right, so boosting them would waste a slot.
 *
 * Deliberately CONSERVATIVE, because the two mistakes are not symmetric. Marking a generic word
 * "distinctive" wastes one keyterm slot and costs nothing else. Marking a proper noun "common" leaves
 * it unboosted and the bug alive. So a word earns its place here only when it is plainly ordinary
 * English — when in doubt it is left out, and the cap trims the tail.
 *
 * This will not cover every trade. That is expected and cheap: an unlisted trade word costs a slot,
 * not a failure.
 */
const COMMON = new Set([
  // structure / filler
  'the', 'and', 'with', 'for', 'from', 'set', 'pcs', 'pc', 'piece', 'pieces', 'unit', 'units',
  'new', 'small', 'medium', 'large', 'mini', 'max', 'left', 'right', 'front', 'back', 'top', 'bottom',
  'high', 'low', 'wide', 'narrow', 'long', 'short', 'round', 'square', 'oval', 'deep',
  // furniture and homeware
  'sofa', 'couch', 'chair', 'stool', 'table', 'desk', 'bed', 'shelf', 'shelving', 'cabinet', 'wardrobe',
  'dresser', 'bench', 'armchair', 'sideboard', 'console', 'nightstand', 'bookcase', 'ottoman', 'pouf',
  'mirror', 'lamp', 'light', 'rug', 'carpet', 'curtain', 'cushion', 'pillow', 'throw', 'blanket',
  'mattress', 'headboard', 'footstool', 'recliner', 'sectional', 'loveseat', 'dining', 'living',
  'bedroom', 'kitchen', 'office', 'outdoor', 'garden', 'corner', 'arm', 'seat', 'seater', 'leg', 'legs',
  'door', 'drawer', 'drawers', 'handle', 'frame', 'base', 'cover', 'panel', 'shelf',
  // materials and finishes
  'oak', 'walnut', 'ash', 'pine', 'teak', 'beech', 'birch', 'mahogany', 'bamboo', 'rattan', 'wicker',
  'marble', 'granite', 'stone', 'glass', 'metal', 'steel', 'brass', 'bronze', 'copper', 'chrome',
  'iron', 'aluminium', 'aluminum', 'wood', 'wooden', 'leather', 'linen', 'cotton', 'velvet', 'wool',
  'fabric', 'suede', 'boucle', 'canvas', 'plastic', 'acrylic', 'ceramic', 'porcelain',
  'matte', 'gloss', 'polished', 'brushed', 'lacquered', 'painted', 'natural', 'antique',
  // colours
  'black', 'white', 'grey', 'gray', 'beige', 'cream', 'ivory', 'sand', 'taupe', 'brown', 'blue',
  'green', 'red', 'yellow', 'pink', 'purple', 'orange', 'gold', 'silver', 'navy', 'charcoal',
  // commerce
  'price', 'sale', 'stock', 'item', 'product', 'model', 'series', 'collection', 'edition', 'size',
])

/** Dimensions, article numbers and bare quantities. Boosting "135x85" helps nobody. */
const isMeasurement = (t: string): boolean => /^[\d.,x×/-]+$/i.test(t) || /^\d/.test(t)

/**
 * Words worth comparing, from a product name. Lowercased, punctuation dropped.
 *
 * Two-character tokens survive here (unlike the grouping tokenizer) because a short proper noun is
 * exactly the case this exists for.
 */
export function termsIn(name: string): string[] {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((t) => t.length > 1)
}

export interface Term {
  term: string
  /** How many products carry it. The ranking signal at the cap, and the answer §1b needs. */
  products: number
}

/**
 * The catalogue's own vocabulary, most-used first.
 *
 * Ranked by product count because at the cap the terms worth keeping are the ones the most callers
 * could ask about. A name on one product and a name on eighty are not equally worth a slot.
 */
export function distinctiveTerms(names: string[]): Term[] {
  const counts = new Map<string, number>()
  for (const name of names) {
    // Per product, not per occurrence: a word repeated in one title is still one product.
    for (const t of new Set(termsIn(name))) {
      if (COMMON.has(t) || isMeasurement(t)) continue
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([term, products]) => ({ term, products }))
    // Ties broken alphabetically so the same catalogue always produces the same list — a keyterm set
    // that reshuffles between calls makes any measurement of its effect meaningless.
    .sort((a, b) => b.products - a.products || a.term.localeCompare(b.term))
}

/**
 * Deepgram caps keyterms at 500 TOKENS, not words, and subword tokenisation is not something we can
 * count from here. 350 words is the conservative stand-in — roughly 1.4 tokens per word, which holds
 * for the short proper nouns this list is made of.
 *
 * Being wrong low costs a few unboosted terms. Being wrong high returns an error and the call gets no
 * keyterms at all, so the asymmetry decides the number.
 */
export const KEYTERM_WORD_BUDGET = 350

/**
 * Below this share of products covered, keyterms are not sent AT ALL.
 *
 * The reason is the failure this is most likely to produce. A tenant with 9,179 products has thousands
 * of distinctive names; 350 slots boost a sliver, every other product stays exactly as broken as it
 * was, and the feature reads as configured and working. A partial fix that looks total is worse than
 * an absent one that says so — the owner would stop looking for the real problem.
 *
 * The number is a judgement, not a measurement, and it is exposed on the endpoint so it can be moved
 * once there is data about how large a catalogue can be before boosting stops helping.
 */
export const MIN_KEYTERM_COVERAGE = 0.5

export type KeytermState = 'ok' | 'truncated' | 'disabled'

export interface KeytermPlan {
  /** What to send to Deepgram. Empty when state is 'disabled'. */
  keyterms: string[]
  state: KeytermState
  /** Distinctive terms found, before the cap. */
  found: number
  /** Products at least one of the SELECTED terms appears in, over total products. */
  coverage: number
  totalProducts: number
  /** Terms that did not fit. Non-zero means some products are unboosted — never hidden. */
  dropped: number
}

/**
 * Decide what to boost, and be explicit when the answer is "nothing".
 *
 * Three outcomes and all of them are reported:
 *   ok        — every distinctive term fits
 *   truncated — the most-used terms fit, the rest are named as dropped
 *   disabled  — too little of the catalogue would be covered to be worth claiming
 */
export function planKeyterms(names: string[]): KeytermPlan {
  const totalProducts = names.length
  const all = distinctiveTerms(names)
  if (!totalProducts || !all.length) {
    return { keyterms: [], state: 'disabled', found: all.length, coverage: 0, totalProducts, dropped: all.length }
  }

  const selected = all.slice(0, KEYTERM_WORD_BUDGET)
  const chosen = new Set(selected.map((t) => t.term))

  // Coverage is measured over PRODUCTS, not terms: what matters is how many things a caller could ask
  // about that we have boosted a word for, not how much of the vocabulary we kept.
  const covered = names.filter((n) => termsIn(n).some((t) => chosen.has(t))).length
  const coverage = covered / totalProducts
  const dropped = all.length - selected.length

  if (coverage < MIN_KEYTERM_COVERAGE) {
    return { keyterms: [], state: 'disabled', found: all.length, coverage, totalProducts, dropped: all.length }
  }
  return {
    keyterms: selected.map((t) => t.term),
    state: dropped > 0 ? 'truncated' : 'ok',
    found: all.length,
    coverage,
    totalProducts,
    dropped,
  }
}
