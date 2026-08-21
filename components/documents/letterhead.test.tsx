import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Letterhead, letterheadPhone, letterheadPhoneAsGiven, letterheadWebsite, type LetterheadData } from './letterhead'

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

// ── THE SECOND DESIGN ───────────────────────────────────────────────────────────────────────────────

const TGD: LetterheadData = {
  enabled: true, style: 'rule', color: '#CB0B24', businessName: 'T.G. DESIGNS',
  website: 'www.tgdiamondsjewellery.com', instagram: null, facebook: null, youtube: null,
  email: 'info@tg-designs.com', phone: '+1.604.683.5633',
  address: '#622-736 Granville, Vancouver, BC V6Z 1G3, Canada',
  tollFree: '+1800 337 0041', tagline: null,
}
const ruleHtml = (over: Partial<LetterheadData> = {}) =>
  renderToStaticMarkup(<Letterhead data={{ ...TGD, ...over }}><p>THE BODY</p></Letterhead>)

describe('the rule design', () => {
  it('prints the second company\'s contacts as they were given, not the first company\'s', () => {
    const out = ruleHtml()
    // The wordmark is not one string: the stone is set into the gap the name already has, so it comes
    // out as "T.G." · svg · "DESIGNS". Asserted in halves rather than by deleting the stone.
    expect(out).toContain('>T.G.<svg')
    expect(out).toContain('>DESIGNS</div>')
    expect(out).toContain('info@tg-designs.com')
    expect(out).toContain('www.tgdiamondsjewellery.com')
    expect(out).toContain('#622-736 Granville, Vancouver, BC V6Z 1G3, Canada')
    // The whole reason the two designs carry separate contact sets. If the retail domain ever appears
    // on a trade document, the profile has been merged into the tenant record somewhere.
    expect(out).not.toContain('tgjewellers.com')
  })

  it('keeps the country code on a number that was typed with one', () => {
    // letterheadPhone would reduce this to 604.683.5633 — a different number to anybody dialling from
    // outside Canada, and not what the artwork prints.
    expect(letterheadPhoneAsGiven('+1.604.683.5633')).toBe('+1.604.683.5633')
    expect(ruleHtml()).toContain('+1.604.683.5633')
    // Ten bare digits are still formatted, because nobody typed those to be read as they are.
    expect(letterheadPhoneAsGiven('6044468438')).toBe('604.446.8438')
  })

  it('prints the toll-free number on its own line and in the accent colour', () => {
    const out = ruleHtml()
    expect(out).toContain('Toll-free number')
    expect(out).toContain('+1800 337 0041')
    // Nothing prints it when she has not given one — a label with no number beside it.
    expect(ruleHtml({ tollFree: null })).not.toContain('Toll-free number')
  })

  it('sets the contacts in sentence case, not the caps the band design uses', () => {
    // The band's contact row is a tracked-out capital line. This one reads as written — an address in
    // caps is a different document.
    expect(ruleHtml()).not.toContain('INFO@TG-DESIGNS.COM')
  })

  it('shows a social mark only for a channel she has actually given', () => {
    const none = ruleHtml()
    expect(none).not.toContain('#1877F2')
    expect(none).not.toContain('url(#lh-ig)')
    const all = ruleHtml({ facebook: 'tgdesigns', instagram: 'tgdesigns', youtube: 'tgdesigns' })
    expect(all).toContain('#1877F2')      // Facebook blue
    expect(all).toContain('url(#lh-ig)')  // the Instagram gradient
    expect(all).toContain('#FF0000')      // YouTube red
  })

  it('draws no header band — the paper is white and the colour is a rule and a footer', () => {
    const out = ruleHtml()
    // The band design paints its header; this one closes it with a hairline instead.
    expect(out).not.toMatch(/lh-rule-head[^>]*background:#CB0B24/)
    expect(out).toContain('lh-rule-foot')
    expect(out).toContain('min-height: 2.61in')
  })

  it('still repeats on every sheet, which is the whole reason for the table', () => {
    const out = ruleHtml()
    expect(out).toMatch(/<thead>[\s\S]*DESIGNS[\s\S]*<\/thead>/)
    expect(out).toMatch(/<tfoot>[\s\S]*lh-rule-foot[\s\S]*<\/tfoot>/)
  })
})

describe('the strip of photography', () => {
  const STRIP = '/letterhead/ring-strip.jpg'

  it('is absent unless she has set one', () => {
    expect(html()).not.toContain('<img')
    expect(ruleHtml()).not.toContain('<img')
  })

  it('prints on BOTH designs, once, and inside tbody rather than tfoot', () => {
    for (const out of [html({ stripUrl: STRIP }), ruleHtml({ stripUrl: STRIP })]) {
      // One IMAGE. The URL itself appears twice, because React emits a <link rel="preload"> for it —
      // counting the raw string would assert the preload rather than the photograph.
      expect(out.match(/<img /g)?.length).toBe(1)
      // tfoot repeats on every sheet — a photograph at the foot of page three of five is wallpaper.
      // tbody's last row lands after the last line of the document, which is the last page.
      expect(out).toMatch(/<tbody>[\s\S]*THE BODY[\s\S]*ring-strip\.jpg[\s\S]*<\/tbody>/)
      expect(out.split('<tfoot>')[1]).not.toContain('ring-strip.jpg')
    }
  })

  it('reserves the body height that pushes it to the foot of a short document', () => {
    // Measured: 11in less the header, the footer, the strip itself, its gap and a sixth of an inch of
    // slack. The slack is what stops a one-page invoice becoming a two-page one — verified by printing
    // both designs to PDF, which came out at one page each.
    expect(html({ stripUrl: STRIP })).toContain('.lh-body { height: 5.48in; }')
    expect(ruleHtml({ stripUrl: STRIP })).toContain('.lh-body { height: 5.64in; }')
  })

  it('reserves nothing at all when there is no strip, so today\'s documents are untouched', () => {
    expect(html()).not.toContain('.lh-body { height:')
  })
})
