import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Letterhead, letterheadPhone, letterheadWebsite, type LetterheadData } from './letterhead'

const TG: LetterheadData = {
  enabled: true, color: '#4E455B', businessName: 'TG JEWELLERS',
  website: 'https://tgjewellers.com/', instagram: 'tgjewellers',
  email: 'sales@tgjewellers.com', phone: '6044468438',
  tagline: 'Custom rings & fine jewellery',
}
const html = (over: Partial<LetterheadData> = {}) =>
  renderToStaticMarkup(<Letterhead data={{ ...TG, ...over }}><p>THE BODY</p></Letterhead>)

describe('letterhead formatting', () => {
  it('prints a North American number as the artwork does', () => {
    expect(letterheadPhone('6044468438')).toBe('604.446.8438')
    expect(letterheadPhone('+1 (604) 446-8438')).toBe('604.446.8438')
  })
  it('leaves a number it does not recognise exactly as she typed it', () => {
    // A phone number invented by a formatter is worse than an unformatted one.
    expect(letterheadPhone('+44 20 7946 0018')).toBe('+44 20 7946 0018')
    expect(letterheadPhone('604-446-8438 ext 2')).toBe('604-446-8438 ext 2')
  })
  it('reduces a website to the host and gives a bare domain its www', () => {
    expect(letterheadWebsite('https://tgjewellers.com/')).toBe('WWW.TGJEWELLERS.COM')
    expect(letterheadWebsite('www.tgjewellers.com')).toBe('WWW.TGJEWELLERS.COM')
    expect(letterheadWebsite('https://shop.tgjewellers.com/rings')).toBe('SHOP.TGJEWELLERS.COM')
  })
})

describe('the letterhead frame', () => {
  it('is nothing at all for a tenant who has not set one up', () => {
    const out = html({ enabled: false })
    expect(out).toBe('<p>THE BODY</p>')
  })

  it('wraps the body rather than replacing it', () => {
    expect(html()).toContain('<p>THE BODY</p>')
  })

  it('prints the wordmark, the four contacts and the tagline', () => {
    const out = html()
    expect(out).toContain('TG JEWELLERS')
    expect(out).toContain('WWW.TGJEWELLERS.COM')
    expect(out).toContain('IG @TGJEWELLERS')
    expect(out).toContain('SALES@TGJEWELLERS.COM')
    expect(out).toContain('604.446.8438')
    expect(out).toContain('Custom rings &amp; fine jewellery')
  })

  it('draws the bands in the tenant\'s own colour, not a hardcoded plum', () => {
    expect(html()).toContain('background:#4E455B')
    expect(html({ color: '#123456' })).toContain('background:#123456')
    expect(html({ color: '#123456' })).not.toContain('#4E455B')
  })

  // The browser's print default is to drop backgrounds. Without this the letterhead prints as two
  // empty rectangles, which is the single failure that would send a blank-headed document to a customer.
  it('forces the bands to survive printing', () => {
    expect(html()).toContain('print-color-adjust:exact')
  })

  // A raster header appears once. thead and tfoot are what put these bands on the second sheet and the
  // tenth as well as the first — verified against a printed three-page PDF, where the position:fixed
  // version this replaced lost its header on page three.
  it('puts the bands in thead and tfoot, which is what makes them repeat', () => {
    const out = html()
    expect(out).toMatch(/<thead>[\s\S]*TG JEWELLERS[\s\S]*<\/thead>/)
    expect(out).toMatch(/<tfoot>[\s\S]*Custom rings[\s\S]*<\/tfoot>/)
    // The body sits between them, so it paginates and they repeat around it.
    expect(out).toMatch(/<tbody>[\s\S]*<p>THE BODY<\/p>[\s\S]*<\/tbody>/)
  })

  it('prints the bands to the paper edge at the artwork\'s proportions', () => {
    const out = html()
    expect(out).toContain('@page { size: letter; margin: 0; }')
    expect(out).toContain('aspect-ratio: 8.5 / 2.31')   // header — 21% of an 11in page
    expect(out).toContain('aspect-ratio: 8.5 / 1.21')   // footer — 11%
    expect(out).toContain('height: 2.31in')
    expect(out).toContain('height: 1.21in')
  })

  it('drops a contact she has not given rather than printing an empty slot', () => {
    const out = html({ instagram: null })
    expect(out).not.toContain('IG @')
    expect(out).toContain('WWW.TGJEWELLERS.COM')
    expect(out).toContain('604.446.8438')
  })
})
