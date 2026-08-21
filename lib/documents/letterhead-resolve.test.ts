import { describe, it, expect } from 'vitest'
import {
  letterheadName, letterheadStyleFor, oneLineAddress, resolveLetterhead,
  type LetterheadBusiness, type LetterheadContext, type LetterheadProfile,
} from './letterhead-resolve'

// The tenant, as the document already knows her: retail.
const TG: LetterheadBusiness = {
  businessName: 'TG jewellers', email: 'tatiana@tgjewellers.com', phone: '6044468438',
  website: 'https://tgjewellers.com/', address: '622 736 Granville street', city: 'vancouver', state: 'bc', zip: null,
}

// The second identity: trade. A different domain, a different address, a number the other does not
// publish. Keeping these two apart is the entire point of the table this comes out of.
const DESIGNS: LetterheadProfile = {
  style: 'rule', name: 'T.G. Designs', businessName: 'T.G. DESIGNS',
  website: 'www.tgdiamondsjewellery.com', email: 'info@tg-designs.com', phone: '+1.604.683.5633',
  address: '#622-736 Granville, Vancouver, BC V6Z 1G3, Canada', tagline: null,
  instagram: null, facebook: null, youtube: null, tollFree: '+1800 337 0041', accentColor: '#CB0B24',
}

const ctx = (over: Partial<LetterheadContext> = {}): LetterheadContext => ({
  enabled: true, defaultStyle: 'band', stripUrl: null,
  tagline: 'Custom rings & fine jewellery', email: 'sales@tgjewellers.com', instagram: 'tgjewellers',
  profiles: { rule: DESIGNS },
  ...over,
})

describe('which letterhead a document goes out on', () => {
  it('is her default when the order has not said otherwise', () => {
    expect(letterheadStyleFor(null, ctx())).toBe('band')
    expect(letterheadStyleFor(undefined, ctx({ defaultStyle: 'rule' }))).toBe('rule')
  })
  it('is the order\'s own choice when it has one', () => {
    expect(letterheadStyleFor('rule', ctx())).toBe('rule')
  })
  it('falls back rather than failing on a value nothing can draw', () => {
    // A hand-edited row, or a design removed in a later release. A document that renders the original
    // stationery is recoverable; one that throws is a customer looking at an error page.
    expect(letterheadStyleFor('engraved', ctx())).toBe('band')
  })
})

describe('whose details are printed', () => {
  it('gives the original design the tenant\'s own, exactly as before profiles existed', () => {
    const d = resolveLetterhead(ctx(), 'band', TG, '#7C3AED')
    expect(d.businessName).toBe('TG jewellers')
    expect(d.website).toBe('https://tgjewellers.com/')
    expect(d.email).toBe('sales@tgjewellers.com')   // her stationery address, not the account's
    expect(d.phone).toBe('6044468438')
    expect(d.tagline).toBe('Custom rings & fine jewellery')
    expect(d.color).toBe('#7C3AED')
  })

  it('gives the second design its own, and never merges the two contact sets', () => {
    const d = resolveLetterhead(ctx(), 'rule', TG, '#7C3AED')
    expect(d.businessName).toBe('T.G. DESIGNS')
    expect(d.website).toBe('www.tgdiamondsjewellery.com')
    expect(d.email).toBe('info@tg-designs.com')
    expect(d.phone).toBe('+1.604.683.5633')
    expect(d.tollFree).toBe('+1800 337 0041')
    expect(d.color).toBe('#CB0B24')                 // its own colour, not the document accent
    // The failure this exists to catch: the retail domain appearing on a trade document.
    expect(JSON.stringify(d)).not.toContain('tgjewellers.com')
  })

  // This used to assert the opposite — that a profile was transparent where it said nothing, and
  // inherited the tenant's phone and address. That fold is what put one business's Instagram mark on
  // another business's letterhead, so it is gone; see the block at the foot of this file for the rule
  // that replaced it.
  it('does NOT inherit the tenant details into a design that has its own identity', () => {
    const thin: LetterheadProfile = { ...DESIGNS, phone: null, address: null, accentColor: null }
    const d = resolveLetterhead(ctx({ profiles: { rule: thin } }), 'rule', TG, '#7C3AED')
    expect(d.phone).toBeNull()
    expect(d.address).toBeNull()
    expect(d.color).toBe('#7C3AED')
  })

  it('never inherits the other one\'s NAME, because the name is how she tells them apart', () => {
    expect(letterheadName(ctx(), 'rule', 'TG jewellers')).toBe('T.G. Designs')
    expect(letterheadName(ctx(), 'band', 'TG jewellers')).toBe('TG jewellers')
  })

  it('is off entirely when there is no colour to draw it in', () => {
    // The same call the first build made: a band in a default black is not her stationery.
    expect(resolveLetterhead(ctx({ profiles: {} }), 'band', TG, null).enabled).toBe(false)
    // …but the second design carries its own colour, so it stands up without a document accent.
    expect(resolveLetterhead(ctx(), 'rule', TG, null).enabled).toBe(true)
  })

  it('is off for a tenant who has not turned stationery on, whichever design is named', () => {
    for (const s of ['band', 'rule'] as const) {
      expect(resolveLetterhead(ctx({ enabled: false }), s, TG, '#7C3AED').enabled).toBe(false)
    }
  })

  it('hands the strip to both designs', () => {
    const c = ctx({ stripUrl: '/letterhead/ring-strip.jpg' })
    expect(resolveLetterhead(c, 'band', TG, '#7C3AED').stripUrl).toBe('/letterhead/ring-strip.jpg')
    expect(resolveLetterhead(c, 'rule', TG, '#7C3AED').stripUrl).toBe('/letterhead/ring-strip.jpg')
  })
})

describe('the tenant address on one line', () => {
  it('reads in the order it would be written', () => {
    expect(oneLineAddress(TG)).toBe('622 736 Granville street, vancouver bc')
  })
  it('is nothing at all rather than a line of commas when she has given nothing', () => {
    expect(oneLineAddress({ ...TG, address: null, city: null, state: null, zip: null })).toBeNull()
  })
})

describe('a profile is the whole identity, or there is no profile', () => {
  // The fold that shipped first — override where you have a value, transparent where you do not —
  // is what put the RETAIL Instagram handle on the TRADE letterhead: the profile leaves it null
  // because the artwork prints the mark without a username, and null meant "inherit".
  const thin: LetterheadProfile = {
    ...DESIGNS, phone: null, email: null, website: null, address: null, instagram: null, tagline: null,
    accentColor: null,
  }
  const d = resolveLetterhead(ctx({ profiles: { rule: thin } }), 'rule', TG, '#7C3AED')

  it('leaves a field the profile does not fill EMPTY, never inherited', () => {
    expect(d.phone).toBeNull()
    expect(d.email).toBeNull()
    expect(d.website).toBeNull()
    expect(d.address).toBeNull()
    expect(d.tagline).toBeNull()
  })

  it('will not borrow the other business\'s social handle', () => {
    // ctx.instagram is 'tgjewellers'. An Instagram mark on a T.G. Designs page pointing at TG
    // Jewellers is not a blank field; it is a claim about a different company.
    expect(d.instagram).toBeNull()
  })

  it('keeps the name, which is the one thing a profile must always state', () => {
    expect(d.businessName).toBe('T.G. DESIGNS')
  })

  it('still takes the document colour, because a hex is not a claim', () => {
    // The exception, and the reason for it: a letterhead that switched itself off when she cleared
    // the swatch would drop the document back to an unbranded layout printing the OTHER identity.
    expect(d.color).toBe('#7C3AED')
    expect(d.enabled).toBe(true)
  })

  it('leaves the fold intact for a style with NO profile at all', () => {
    // 'band' has no identity of its own to speak of, so it falls through to the tenant record —
    // which is where it came from before a second letterhead existed.
    const band = resolveLetterhead(ctx(), 'band', TG, '#7C3AED')
    expect(band.phone).toBe('6044468438')
    expect(band.email).toBe('sales@tgjewellers.com')
    expect(band.instagram).toBe('tgjewellers')
  })
})
