import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The customer's page and the showroom tag, guarded at the source. These are structural assertions
// on purpose: what matters is which FIELDS reach a page with no session behind it, and that is a
// property of the code, not of any one product row.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const PUBLIC_PAGE = 'app/p/[token]/page.tsx'
const GALLERY = 'components/studio/product-gallery.tsx'
const TAG = 'app/studio/[id]/print/page.tsx'

// Columns on studio_products / studio_variants that the tenant's customer must never be shown.
const STAFF_ONLY = ['internal_notes', 'supplier_name', 'supplier_email']

describe('the public product page is read-only and staff-blind', () => {
  const src = read(PUBLIC_PAGE)

  it.each(STAFF_ONLY)('never renders %s', (field) => {
    expect(src).not.toMatch(new RegExp(`\\{[^}]*\\b${field}\\b`))
  })

  it('stays a server component — the token lookup must not move into the browser', () => {
    expect(src).not.toMatch(/^\s*['"]use client['"]/m)
  })

  it('writes nothing: no insert, update, upsert or delete on the public path', () => {
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/)
  })

  it('resolves strictly by qr_token, never by a guessable product id', () => {
    expect(src).toMatch(/\.eq\('qr_token', token\)/)
  })

  it('hides an archived product', () => {
    expect(src).toMatch(/status === 'archived'/)
  })

  it('keeps itself out of search results', () => {
    expect(src).toMatch(/robots:\s*\{\s*index:\s*false/)
  })
})

describe('staff mode on the public page', () => {
  const src = read(PUBLIC_PAGE)
  const panel = read('components/studio/staff-edit-panel.tsx')

  it('decides staff from the SERVER, using the tenant the token resolved to', () => {
    expect(src).toMatch(/canEditStudioTenant\(product\.tenant_id\)/)
  })

  it('never reads staff-ness from the URL, a query string or a header', () => {
    expect(src).not.toMatch(/searchParams/)
    expect(src).not.toMatch(/\bedit=|\?edit|['"]x-/)
  })

  it('offers the editor only for a PRODUCT token, not a sub-product one', () => {
    expect(src).toMatch(/!activeVariantId && \(await canEditStudioTenant/)
  })

  it('renders the panel behind the flag, so the public page is the default', () => {
    expect(src).toMatch(/\{canEdit && \(/)
  })

  it('does not redirect or 401 a visitor without a session — /p/ stays public', () => {
    expect(src).not.toMatch(/redirect\(|unauthorized\(/)
  })

  it('the panel saves through the existing studio API, not a new write path', () => {
    expect(panel).toMatch(/`\/api\/studio\/products\/\$\{productId\}`/)
    expect(panel).toMatch(/method: 'PATCH'/)
    expect(panel).toMatch(/'\/api\/studio\/upload'/)
  })

  it('the panel sends ONLY photos, description and price', () => {
    const body = panel.match(/JSON\.stringify\(\{([^}]*)\}\)/)?.[1] ?? ''
    expect(body).toContain('photos')
    expect(body).toContain('description')
    expect(body).toContain('base_price')
    for (const k of ['internal_notes', 'supplier_', 'status', 'tenant_id', 'qr_token']) {
      expect(body).not.toContain(k)
    }
  })

  it('the panel never renders internal or supplier fields', () => {
    for (const f of STAFF_ONLY) expect(panel).not.toContain(f)
  })

  it('the panel says out loud that customers cannot see it', () => {
    expect(panel).toContain('Staff only')
    expect(panel).toMatch(/aria-label="Staff editing"/)
  })

  it('the panel cannot change the QR — it only links to the print page', () => {
    expect(panel).toMatch(/`\/studio\/\$\{productId\}\/print`/)
    expect(panel).not.toMatch(/qr_token\s*[:=]/)
  })
})

describe('the gallery', () => {
  const src = read(GALLERY)

  it('is the one client component, and takes only finished URLs and a name', () => {
    expect(src).toMatch(/^\s*['"]use client['"]/m)
    expect(src).toMatch(/photos:\s*string\[\];\s*name:\s*string/)
  })

  it('carries no identifiers a reader could walk back to another product', () => {
    for (const leak of ['tenant_id', 'qr_token', 'product_id', 'base_price']) {
      expect(src).not.toContain(leak)
    }
  })

  it('opens larger, and can be closed and driven from a keyboard', () => {
    expect(src).toMatch(/aria-modal="true"/)
    expect(src).toMatch(/'Escape'/)
    expect(src).toMatch(/'ArrowRight'/)
    expect(src).toMatch(/'ArrowLeft'/)
  })

  it('works under a thumb: swipe, and a body-scroll lock while open', () => {
    expect(src).toMatch(/onTouchStart/)
    expect(src).toMatch(/onTouchEnd/)
    expect(src).toMatch(/document\.body\.style\.overflow = 'hidden'/)
  })

  it('renders nothing rather than an empty frame when there are no photos', () => {
    expect(src).toMatch(/if \(count === 0\) return null/)
  })
})

describe('the printed tag carries the CUSTOMER url, not the staff one', () => {
  const src = read(TAG)

  it('builds the target with publicProductUrl(qr_token)', () => {
    expect(src).toMatch(/publicProductUrl\(product\.qr_token/)
  })

  it('never prints a staff path', () => {
    // /catalog/<id> and /studio/<id> are the two internal product URLs. The only /studio/ reference
    // allowed here is the "Back to the product" link, which is print:hidden.
    const printed = src.split('print:hidden').join('')
    expect(printed).not.toMatch(/`\/catalog\/\$\{/)
  })

  it('is gated by the studio session AND scoped by tenant', () => {
    expect(src).toMatch(/requireStudioTenant\(\)/)
    expect(src).toMatch(/\.eq\('tenant_id', s\.tenantId\)/)
  })

  it('shows the name and the SKU, and no price', () => {
    expect(src).toContain('{product.name}')
    expect(src).toContain('{sku}')
    expect(src).not.toMatch(/base_price/)
  })

  it('keeps its controls off the sheet', () => {
    expect(src).toMatch(/print:hidden/)
  })
})

describe('the catalog page reaches Studio without touching the customer surface', () => {
  const src = read('components/studio/studio-sections.tsx')

  it('offers a staff route into the linked studio product', () => {
    expect(src).toMatch(/href=\{`\/studio\/\$\{product\.id\}`\}/)
    expect(src).toContain('Open in Studio')
  })

  it('renders nothing at all when the session cannot see the studio product', () => {
    // The whole component — the Open in Studio link included — is behind this guard, and the fetch
    // it depends on 403s for a tenant without the module. A catalog page must never show a staff
    // link into a product it cannot open.
    expect(src).toMatch(/if \(!ready \|\| !product\) return null/)
  })

  it('still prints the CUSTOMER code, and still points the QR at the public page', () => {
    expect(src).toMatch(/\/studio\/\$\{product\.id\}\/print/)
    expect(src).toContain('Customer scan')
  })
})

describe('every studio API route is tenant-scoped', () => {
  function routes(dir: string): string[] {
    return readdirSync(dir).flatMap((e) => {
      const full = join(dir, e)
      if (statSync(full).isDirectory()) return routes(full)
      return e === 'route.ts' ? [full] : []
    })
  }
  const files = routes(join(process.cwd(), 'app/api/studio'))

  it('finds the routes at all', () => expect(files.length).toBeGreaterThan(5))

  it.each(files.map((f) => f.slice(process.cwd().length + 1)))('%s gates on requireStudioTenant', (rel) => {
    expect(read(rel)).toMatch(/requireStudioTenant\(\)/)
  })

  it.each(files.map((f) => f.slice(process.cwd().length + 1)))('%s scopes every studio query by tenant', (rel) => {
    const src = read(rel)
    // Any read/write of a studio_* or catalog_* table must be followed somewhere by a tenant filter.
    if (/\.from\('(studio_|catalog_)/.test(src)) {
      expect(src, `${rel} touches tenant tables without a tenant filter`).toMatch(/\.eq\('tenant_id', s\.tenantId\)/)
    }
  })
})
