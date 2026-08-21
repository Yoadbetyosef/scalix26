import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OrderDocumentBody } from './document-body'
import { rateFor, taxOn, CA_RATES_FALLBACK } from '@/lib/tax/canada'
import type { OrderWithDetails } from '@/lib/orders/types'

// The document is asserted by its RENDERED OUTPUT, not by which component the routes import.
//
// The previous parity test checked that both routes render OrderDocumentBody and call the shared
// loader. It passed while the two pages visibly differed — the owner saw the ring and the customer
// did not — because sharing a component says nothing about being handed the same data. A test that
// cannot fail on the bug it exists to catch is worse than no test: it is a claim of coverage.
//
// So this renders the real component and reads the HTML.

const line = (over: Partial<OrderWithDetails['lineItems'][number]> = {}) => ({
  id: 'l1', orderId: 'o1', productName: 'RAJA Solitaire Ring', description: 'Platinum, 1.2ct',
  sku: null, quantity: 1, unitPriceCents: 600_000, measurements: null, color: null, material: null,
  customSpec: null, productRef: null, lineTotalCents: 600_000, displayOrder: 0,
  internalCostCents: 250_000,
  stoneQuality: null, stoneColor: null, stoneOrigin: null, stoneType: null,
  centerStoneShape: null, sideStoneShape: null, centerStoneCarat: null, sideStoneCaratTotal: null,
  metalKarat: null, certificateLab: null, ringSize: null,
  ...over,
}) as OrderWithDetails['lineItems'][number]

const order = (over: Partial<OrderWithDetails> = {}): OrderWithDetails => ({
  id: 'o1', tenantId: 't1', orderNumber: 'ORD-KCKZQEGV', contactId: null,
  customerName: 'Tatiana', customerEmail: 'c@example.com', customerPhone: null,
  stage: 'new', supplierId: null, factoryName: null, factoryContactName: null, factoryEmail: null,
  assignedEmployee: null, orderDate: null, requestedCompletionDate: null, estimatedCompletionDate: null,
  subtotalCents: 600_000, depositCents: 0, balanceCents: 600_000, currency: 'cad',
  clientRequirements: null, isCustomDesign: true, internalNotes: 'MARGIN 58% — never show this',
  publicNotes: null, createdBy: null, createdAt: '', updatedAt: '',
  deliveryProvince: 'ON', documentTemplateId: null, invoicedAt: null, archivedAt: null,
  lineItems: [line()], events: [],
  ...over,
})

const NO_LETTERHEAD = {
  enabled: false, defaultStyle: 'band' as const, stripUrl: null,
  tagline: null, email: null, instagram: null, profiles: {},
}
const IMAGES = [{ id: 'a1', url: 'https://storage.example/signed/ring.webp?token=abc', fileName: 'ring.webp' }]
const TAX = taxOn(600_000, rateFor('ON', CA_RATES_FALLBACK))

const render = (over: Partial<Parameters<typeof OrderDocumentBody>[0]> = {}) =>
  renderToStaticMarkup(
    <OrderDocumentBody
      order={order()}
      type="quote"
      branding={{ logoUrl: null, accent: null, terms: null, validityDays: 30, letterhead: NO_LETTERHEAD }}
      business={{ businessName: 'TG jewellers', email: null, phone: null, website: null, address: null, city: null, state: null, zip: null }}
      images={IMAGES}
      tax={TAX}
      {...over}
    />,
  )

describe('the rendered document contains what the customer must see', () => {
  const html = render()

  it('renders the image, with its src', () => {
    // The bug: the customer's copy rendered without it, because the gallery came back empty from a
    // session-scoped read. An empty gallery is INVISIBLE — the document still looks complete.
    expect(html).toContain('<img')
    expect(html).toContain(IMAGES[0].url)
  })

  it('renders the prices — that is what makes it an estimate', () => {
    expect(html).toContain('6,000.00')
  })

  it('renders the line items by name', () => {
    expect(html).toContain('RAJA Solitaire Ring')
    expect(html).toContain('Item 1')
  })

  it('renders the tax line with its rate and region', () => {
    expect(html).toContain('HST 13%')
    expect(html).toContain('(ON)')
    expect(html).toContain('780.00')
  })
})

describe('the rendered document never contains what it must not', () => {
  const html = render()

  it('shows no internal cost', () => {
    // The fixture line carries internalCostCents: 250_000.
    expect(html).not.toContain('2,500.00')
    expect(html).not.toMatch(/internal cost/i)
  })

  it('shows no internal notes', () => {
    expect(html).not.toContain('MARGIN 58%')
  })

  it('names no platform', () => {
    expect(html).not.toMatch(/scalix/i)
  })
})

describe('parity: the same props render the same document', () => {
  it('the owner copy and the customer copy differ ONLY by the toolbar', () => {
    // Both routes hand the loader's output straight to this component. The only prop that differs is
    // `toolbar`, so rendering with and without it and stripping that region must leave identical
    // documents. If a future change makes the body read anything else — a session, a flag, the
    // request — this fails.
    const owner = render({ toolbar: <button>Send to customer</button> })
    const customer = render({ toolbar: <button>Print</button> })
    // [\s\S] rather than the /s flag: /s needs an es2018 target and tsc rejects it here.
    const strip = (h: string) => h.replace(/<div class="[^"]*print:hidden">[\s\S]*?<\/div>/, '')
    expect(strip(owner)).toBe(strip(customer))
  })

  it('an empty gallery is detectable — the guard against the bug returning', () => {
    // Proof this suite can actually fail on the fault it exists to catch.
    expect(render({ images: [] })).not.toContain('<img')
  })
})

// ── TWO IDENTITIES MUST NEVER MEET ON ONE PAGE ──────────────────────────────────────────────────────
//
// The bug this exists to catch, found on a real estimate rather than by this suite: the header
// correctly printed T.G. DESIGNS on tg-designs.com, and directly beneath it the BODY printed the
// tenant record — "TG jewellers", the Granville street address as she typed it, tatiana@tgjewellers.com,
// 6044468438, https://tgjewellers.com. Two contradictory businesses on one page, with the wrong name
// in the larger type.
//
// There WAS a test asserting the retail domain could not appear on a rule document. It passed, because
// it only ever looked at the letterhead component's own output. The document is what the customer
// holds, so the assertion belongs here, and it covers every field rather than the domain alone.

const TENANT = {
  businessName: 'TG jewellers', email: 'tatiana@tgjewellers.com', phone: '6044468438',
  website: 'https://tgjewellers.com/', address: '622 736 Granville street ',
  city: 'vancouver ', state: 'bc', zip: null,
}

// Exactly the row in the database, read back from it — not the seed the migration wrote, which is a
// different claim. See the verification in this session.
const DESIGNS_PROFILE = {
  style: 'rule' as const, name: 'T.G. Designs', businessName: 'T.G. DESIGNS',
  website: 'www.tgdiamondsjewellery.com', email: 'info@tg-designs.com', phone: '+1.604.683.5633',
  address: '#622-736 Granville, Vancouver, BC V6Z 1G3, Canada',
  tagline: null, instagram: null, facebook: null, youtube: null,
  tollFree: '+1800 337 0041', accentColor: '#cb0b24',
}

// What studio_doc_settings holds for her, all of it retail — the fallback that leaked.
const LETTERHEAD_ON = {
  enabled: true, stripUrl: '/letterhead/ring-strip.jpg',
  tagline: 'Custom rings & fine jewellery', email: 'sales@tgjewellers.com', instagram: 'TG Jewellers',
}

const onDesigns = (over: Partial<Parameters<typeof OrderDocumentBody>[0]> = {}) =>
  render({
    branding: {
      logoUrl: 'https://storage.example/logo.png', accent: '#350f76', terms: null, validityDays: 30,
      letterhead: { ...LETTERHEAD_ON, defaultStyle: 'rule' as const, profiles: { rule: DESIGNS_PROFILE } },
    },
    business: TENANT,
    ...over,
  })

describe('a T.G. Designs document is T.G. Designs all the way down', () => {
  const html = onDesigns()

  // Field by field, and the whole page each time — header, body, footer.
  const RETAIL: Array<[string, string]> = [
    ['the business name', 'TG jewellers'],
    ['the retail domain', 'tgjewellers.com'],
    ['the retail email', 'tatiana@tgjewellers.com'],
    ['the stationery email', 'sales@tgjewellers.com'],
    ['the retail phone', '6044468438'],
    ['the formatted retail phone', '604.446.8438'],
    ['the street as she typed it', '622 736 Granville street'],
    ['the retail Instagram handle', 'TG JEWELLERS'],
    ['the retail tagline', 'Custom rings'],
  ]
  for (const [what, needle] of RETAIL) {
    it(`prints none of ${what}`, () => {
      expect(html).not.toContain(needle)
    })
  }

  it('prints the trade identity, from the profile row and nowhere else', () => {
    // The wordmark is not one string — the stone is set into the gap the name already has, so it
    // renders as "T.G." · svg · "DESIGNS".
    expect(html).toContain('>T.G.<svg')
    expect(html).toContain('>DESIGNS</div>')
    expect(html).toContain('info@tg-designs.com')
    expect(html).toContain('www.tgdiamondsjewellery.com')
    expect(html).toContain('#622-736 Granville, Vancouver, BC V6Z 1G3, Canada')
    expect(html).toContain('+1.604.683.5633')
    expect(html).toContain('+1800 337 0041')
  })

  it('drops the body sender block entirely — the identity is stated ONCE', () => {
    // Not "states the right one twice". Twice is the shape of the bug even when both agree.
    expect(html.match(/>DESIGNS<\/div>/g)?.length).toBe(1)
    // The logo is the wordmark a second time, so it goes with the rest of the block.
    expect(html).not.toContain('storage.example/logo.png')
  })

  it('shows a social mark only where the PROFILE has a handle', () => {
    // All three are null on her row, and the tenant's "TG Jewellers" handle must not stand in for
    // them — an Instagram mark on a T.G. Designs page pointing at the other company is a claim, not
    // a blank. This is why exactly one icon was showing on the real estimate.
    expect(html).not.toContain('#1877F2')      // Facebook
    expect(html).not.toContain('url(#lh-ig)')  // Instagram
    expect(html).not.toContain('#FF0000')      // YouTube

    const withSocials = onDesigns({
      branding: {
        logoUrl: null, accent: '#350f76', terms: null, validityDays: 30,
        letterhead: {
          ...LETTERHEAD_ON, defaultStyle: 'rule' as const,
          profiles: { rule: { ...DESIGNS_PROFILE, facebook: 'tgdesigns', instagram: 'tgdesigns', youtube: 'tgdesigns' } },
        },
      },
    })
    expect(withSocials).toContain('#1877F2')
    expect(withSocials).toContain('url(#lh-ig)')
    expect(withSocials).toContain('#FF0000')
  })
})

describe('the plum letterhead keeps the tenant identity, and still states it once', () => {
  // No profile row for 'band', so it falls through to the tenant record exactly as it did before
  // profiles existed. That fold is the only one left, and this is what protects it.
  const html = render({
    branding: {
      logoUrl: null, accent: '#350f76', terms: null, validityDays: 30,
      letterhead: { ...LETTERHEAD_ON, defaultStyle: 'band' as const, profiles: {} },
    },
    business: TENANT,
  })

  it('prints the tenant details, because that IS its identity', () => {
    expect(html).toContain('TG JEWELLERS')                 // the band sets the wordmark in caps
    expect(html).toContain('SALES@TGJEWELLERS.COM')
    expect(html).toContain('604.446.8438')
  })

  it('states them in the band and not again in the body', () => {
    expect(html).not.toContain('622 736 Granville street')
    expect(html).not.toContain('tatiana@tgjewellers.com')
    expect(html.match(/TG JEWELLERS/g)?.length).toBe(1)
  })
})
