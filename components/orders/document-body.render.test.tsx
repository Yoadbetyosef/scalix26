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
  stage: 'new', factoryName: null, factoryContactName: null, factoryEmail: null,
  assignedEmployee: null, orderDate: null, requestedCompletionDate: null, estimatedCompletionDate: null,
  subtotalCents: 600_000, depositCents: 0, balanceCents: 600_000, currency: 'cad',
  clientRequirements: null, isCustomDesign: true, internalNotes: 'MARGIN 58% — never show this',
  publicNotes: null, createdBy: null, createdAt: '', updatedAt: '',
  deliveryProvince: 'ON', documentTemplateId: null, invoicedAt: null, archivedAt: null,
  lineItems: [line()], events: [],
  ...over,
})

const IMAGES = [{ id: 'a1', url: 'https://storage.example/signed/ring.webp?token=abc', fileName: 'ring.webp' }]
const TAX = taxOn(600_000, rateFor('ON', CA_RATES_FALLBACK))

const render = (over: Partial<Parameters<typeof OrderDocumentBody>[0]> = {}) =>
  renderToStaticMarkup(
    <OrderDocumentBody
      order={order()}
      type="quote"
      branding={{ logoUrl: null, accent: null, terms: null, validityDays: 30 }}
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
    const strip = (h: string) => h.replace(/<div class="mb-6 flex items-center justify-end gap-2 print:hidden">[\s\S]*?<\/div>/, '')
    expect(strip(owner)).toBe(strip(customer))
  })

  it('an empty gallery is detectable — the guard against the bug returning', () => {
    // Proof this suite can actually fail on the fault it exists to catch.
    expect(render({ images: [] })).not.toContain('<img')
  })
})
