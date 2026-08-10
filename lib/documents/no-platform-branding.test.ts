import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { isCustomerDocumentPath, NEUTRAL_BRAND } from './routes'

// The platform's name must not appear on a document a tenant sends to their customer.
//
// This bug shipped INSIDE the commit that built the white-label system ("Remove Scalix26 branding,
// mobile optimization, white-label brand system", 4 Jun 2026). The root layout's title was set to
// `${brand.name} — AI Employee Platform`, every document route inherits the root layout, and Chrome
// prints document.title at the top of every printed page — so for four weeks every estimate, quote,
// invoice and approval page went out with our name across the top, including five white-label
// tenants whose whole proposition is that we are invisible.
//
// A comment saying "don't do that" would not have caught it. These assertions are the mechanism.

const DOCUMENT_ROUTES = [
  'app/orders/[id]/document/[type]/page.tsx',
  'app/d/[token]/page.tsx',
  'app/approval/[token]/page.tsx',
]

/** Anything that names us. Case-insensitive, so a lowercase slug is caught too. */
const PLATFORM_NAMES = [/scalix/i, /AI Employee Platform/i]

/**
 * Source with comments removed.
 *
 * What matters is what RENDERS. These files explain the bug in their own comments — and the first
 * version of this test failed on that explanation, which would have taught the next person to delete
 * the explanation rather than fix a leak. Assert on the code.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments, including JSX {/* … */} bodies
    .replace(/^\s*\/\/.*$/gm, ' ')        // whole-line // comments
}

describe('customer document routes name nobody but the tenant', () => {
  it.each(DOCUMENT_ROUTES)('%s contains no platform name', (file) => {
    const src = code(file)
    for (const re of PLATFORM_NAMES) expect(src).not.toMatch(re)
  })

  it.each(DOCUMENT_ROUTES)('%s supplies its OWN title', (file) => {
    // Without this the route inherits the root layout's, which is where the leak came from. A route
    // that renders a document and does not name itself is the exact shape of the original bug.
    expect(code(file)).toMatch(/export async function generateMetadata/)
  })
})

describe('the root layout refuses to brand a customer document', () => {
  it('routes the document paths to a neutral brand before the host fallback', () => {
    const src = code('app/layout.tsx')
    const fn = src.slice(src.indexOf('const resolveActiveBrand'), src.indexOf('export const viewport'))
    const neutral = fn.indexOf('isCustomerDocumentPath')
    const host = fn.indexOf("get('host')")
    expect(neutral).toBeGreaterThan(-1)
    // ORDER matters, not just presence: the host fallback is what produced our name, so the document
    // check has to come first or it never runs.
    expect(neutral).toBeLessThan(host)
  })

  it('the neutral brand carries no name and no platform flags', () => {
    expect(NEUTRAL_BRAND.name).toBe('')
    // Both of these render visible "Powered by Scalix" text elsewhere in the app.
    expect(NEUTRAL_BRAND.poweredByScalix).toBe(false)
    expect(NEUTRAL_BRAND.isPartnerBrand).toBe(false)
  })
})

describe('isCustomerDocumentPath', () => {
  it('matches the three document surfaces', () => {
    expect(isCustomerDocumentPath('/orders/abc-123/document/estimate')).toBe(true)
    expect(isCustomerDocumentPath('/d/tok_123')).toBe(true)
    expect(isCustomerDocumentPath('/approval/tok_123')).toBe(true)
  })

  it('does NOT match the owner’s own order screen', () => {
    // /orders/[id] is the tenant's workspace and keeps the app's chrome and brand.
    expect(isCustomerDocumentPath('/orders/abc-123')).toBe(false)
    expect(isCustomerDocumentPath('/orders')).toBe(false)
    expect(isCustomerDocumentPath('/dashboard')).toBe(false)
  })
})

describe('the printed page carries no browser header or footer', () => {
  it('globals.css zeroes the @page margin', () => {
    // Chrome draws its header and footer in the page MARGIN and omits them when there is none. There
    // is no CSS property that disables them directly, so this rule IS the fix.
    const css = readFileSync('app/globals.css', 'utf8')
    const print = css.slice(css.lastIndexOf('@media print'))
    expect(print).toMatch(/@page\s*\{\s*margin:\s*0/)
  })
})

describe('the approval page prints as a work order', () => {
  const src = () => readFileSync('app/approval/[token]/page.tsx', 'utf8')

  it('offers a print button', () => {
    // This is the surface the factory opens, and a workshop works from paper at the bench.
    expect(src()).toMatch(/<PrintButton\s*\/>/)
  })

  it('hides the interactive halves from paper', () => {
    // A decision form and an upload widget do nothing on a printed page; leaving them in wastes the
    // space a spec table needs.
    const code = src()
    expect(code).toMatch(/data-print-hidden/)
    // Both of them, not just whichever was remembered.
    expect(code.match(/data-print-hidden/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('the print stylesheet flattens the card', () => {
    // On screen it is a card on grey; on paper that is the browser pretending to be a screen.
    const print = readFileSync('app/globals.css', 'utf8')
    const block = print.slice(print.lastIndexOf('@media print'))
    expect(block).toMatch(/\.approval-card/)
    expect(block).toMatch(/border:\s*none\s*!important/)
  })

  it('the title names nobody rather than being empty', () => {
    // Empty leaves the browser showing the URL in the tab, which is the same leak in another place.
    expect(src()).toMatch(/title:\s*'Order approval'/)
  })
})
