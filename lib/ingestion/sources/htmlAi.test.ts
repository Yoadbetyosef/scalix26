import { describe, it, expect } from 'vitest'
import { isConfident, shouldStopForLowConfidence, CONFIDENCE_SAMPLE, CONFIDENCE_MIN_HITS } from './htmlAi'
import { deriveFieldMap, applyFieldMap, mapIsUsable } from './htmlAi'

// The give-up gate. Its whole job is to stop before spending 100 Haiku calls on a site that turns out
// not to be a shop, and the situation that triggers it — URLs that look like products, pages that
// aren't — is one you cannot arrange against a live site on demand. So it is pinned here.

describe('low-confidence gate', () => {
  it('counts a page as a product only when a name comes with a price or a code', () => {
    // A page title alone is what every page has; accepting it would defeat the gate entirely.
    expect(isConfident({ title: 'About our team' })).toBe(false)
    expect(isConfident({ title: 'Kwikset 334', price: '30.97' })).toBe(true)
    expect(isConfident({ title: 'Kwikset 334', sku: 'KW334-11P' })).toBe(true)
    expect(isConfident({ title: 'Kwikset 334', price: 0 })).toBe(true)      // free is a price
    expect(isConfident({ title: 'Kwikset 334', sku: '   ' })).toBe(false)   // whitespace is not a code
    expect(isConfident(null)).toBe(false)
  })

  it('stops once the sample is in and too few pages looked like products', () => {
    expect(shouldStopForLowConfidence({ seen: CONFIDENCE_SAMPLE, confidentHits: 0, hasFieldMap: false })).toBe(true)
    expect(shouldStopForLowConfidence({ seen: CONFIDENCE_SAMPLE, confidentHits: 1, hasFieldMap: false })).toBe(true)
  })

  it('carries on when the sample found products', () => {
    expect(shouldStopForLowConfidence({ seen: CONFIDENCE_SAMPLE, confidentHits: CONFIDENCE_MIN_HITS, hasFieldMap: false })).toBe(false)
    expect(shouldStopForLowConfidence({ seen: 40, confidentHits: 38, hasFieldMap: false })).toBe(false)
  })

  it('does not judge before the sample is complete', () => {
    expect(shouldStopForLowConfidence({ seen: CONFIDENCE_SAMPLE - 1, confidentHits: 0, hasFieldMap: false })).toBe(false)
  })

  it('never gates a source replaying a saved field map, which costs nothing per page', () => {
    expect(shouldStopForLowConfidence({ seen: 100, confidentHits: 0, hasFieldMap: true })).toBe(false)
  })
})

// The other half of the cost story: once the model has read one page, we work out where that page
// keeps its fields and stop paying. Verified here against markup shaped like the real thing.
describe('field map derivation', () => {
  const html = `
    <html><head>
      <meta property="og:title" content="Kwikset 334 11P Round Pocket Door Lock">
      <meta property="og:image" content="https://cdn.example.com/kw334.jpg">
    </head><body>
      <h1 class="product-title">Kwikset 334 11P Round Pocket Door Lock</h1>
      <span class="price-now">30.97</span>
    </body></html>`

  const extracted = { title: 'Kwikset 334 11P Round Pocket Door Lock', price: '30.97', image_url: 'https://cdn.example.com/kw334.jpg' }

  it('finds each value where the page actually keeps it', () => {
    const map = deriveFieldMap(html, extracted)
    expect(map.title).toBe('meta:og:title')
    expect(map.image_url).toBe('meta:og:image')
    expect(map.price).toBe('class:price-now')
  })

  it('replays deterministically, which is what makes the model a one-off cost', () => {
    const replayed = applyFieldMap(html, deriveFieldMap(html, extracted))
    expect(replayed.title).toBe(extracted.title)
    expect(replayed.price).toBe('30.97')
  })

  it('refuses to save a map that does not reproduce what the model found', () => {
    expect(mapIsUsable({ title: 'meta:og:description' }, html, extracted)).toBe(false)
    expect(mapIsUsable(deriveFieldMap(html, extracted), html, extracted)).toBe(true)
  })
})
