import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'

// The owner's document and the customer's must be the same document.
//
// A customer who receives something different from what the owner printed has been sent a different
// document, and the discrepancy surfaces as a dispute rather than a bug report. These assertions make
// that structural: both routes render the same component from the same loader, and neither is allowed
// to grow its own copy of the body.

const OWNER = 'app/orders/[id]/document/[type]/page.tsx'
const CUSTOMER = 'app/e/[token]/page.tsx'
const read = (f: string) => readFileSync(f, 'utf8')

/**
 * Source with comments stripped.
 *
 * What matters is what RENDERS. These files explain their own design in comments, and asserting over
 * the comments teaches the next person to delete the explanation rather than fix a leak — the same
 * trap lib/documents/no-platform-branding.test.ts already fell into once.
 */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

describe('one body, two entry points', () => {
  it.each([OWNER, CUSTOMER])('%s renders the shared body', (f) => {
    expect(read(f)).toMatch(/<OrderDocumentBody/)
  })

  it.each([OWNER, CUSTOMER])('%s assembles its data through the shared loader', (f) => {
    expect(read(f)).toMatch(/loadOrderDocument\(/)
  })

  it('neither route re-implements the line items', () => {
    // If a route starts mapping lineItems itself, it has begun a second template.
    for (const f of [OWNER, CUSTOMER]) expect(code(f)).not.toMatch(/lineItems\.map/)
  })
})

describe('the customer copy is a document, not a decision', () => {
  it('offers no approve or reject', () => {
    // Approval lives on /approval/[token]. A page that shows a price AND asks for a decision is a
    // contract, which is not what an estimate is.
    const src = code(CUSTOMER)
    expect(src).not.toMatch(/approve/i)
    expect(src).not.toMatch(/reject/i)
    expect(src).not.toMatch(/PublicApprovalForm/)
  })

  it('gives the customer only a print control', () => {
    const src = code(CUSTOMER)
    expect(src).toMatch(/<PrintButton \/>/)
    // Owner-only controls must not appear on the recipient's copy.
    expect(src).not.toMatch(/DocumentBranding/)
    expect(src).not.toMatch(/SendDocument/)
  })

  it('names the tenant in its title, never the platform', () => {
    const src = code(CUSTOMER)
    expect(src).toMatch(/generateMetadata/)
    expect(src).not.toMatch(/scalix/i)
  })
})

describe('internal cost never reaches the shared body', () => {
  it('the document component does not mention it', () => {
    // The body is now rendered to customers directly, so the exclusion matters more than before.
    const src = readFileSync('components/orders/document-body.tsx', 'utf8')
    expect(src).not.toMatch(/internalCostCents|internal_cost_cents/)
  })
})

describe('the share token is never stored raw', () => {
  it('only its hash is written', () => {
    const src = readFileSync('lib/orders/shares.ts', 'utf8')
    expect(src).toMatch(/token_hash: hash/)
    // The raw token exists in the emailed link and nowhere else.
    expect(src).not.toMatch(/token_raw|raw_token|token: token/)
  })

  it('resolve returns null for every failure, without saying which', () => {
    // Distinguishing revoked from expired from unknown is free information for somebody guessing.
    const src = readFileSync('lib/orders/shares.ts', 'utf8')
    const fn = src.slice(src.indexOf('export async function resolveShare'))
    expect(fn).toMatch(/revoked_at\) return null/)
    // [\s\S] rather than the /s flag: the project's TS target predates es2018 and /s fails to compile.
    expect(fn).toMatch(/expires_at[\s\S]*return null/)
  })
})
