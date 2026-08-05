import { describe, it, expect, vi, afterEach } from 'vitest'
import { detectPlatform } from './detector'
import { DomainRateLimiter } from './rateLimiter'

// The real limiter paces one request per second per domain; against a stub that would just make the
// test slow without testing anything. Politeness has its own coverage.
const fast = () => new DomainRateLimiter(0)

// A Shopify store that refuses /products.json — some do, behind a WAF or an app that locks the
// endpoint down. The tier that answers must not be "we can't read this site": the store still
// publishes a product sitemap and JSON-LD on every product page, so detection has to walk past the
// closed door and land on the crawl tier.
//
// Stubbed rather than live, because a store that blocks products.json is not something you can go
// and find on demand — and when one does turn up, it will be a customer, not a test fixture.

const html = (body: string) => `<html><head><title>Shop</title></head><body>${body}</body></html>`

const PRODUCT_PAGE = html(`
  <h1>Brass Deadbolt</h1>
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Product","name":"Brass Deadbolt","sku":"BD-1",
     "image":"https://cdn.example.com/bd1.jpg",
     "offers":{"@type":"Offer","price":"49.99","priceCurrency":"USD","availability":"https://schema.org/InStock"}}
  </script>`)

const SITEMAP = `<?xml version="1.0"?><urlset>
  <url><loc>https://shop.example.com/products/brass-deadbolt</loc></url>
  <url><loc>https://shop.example.com/products/steel-hinge</loc></url>
  <url><loc>https://shop.example.com/products/oak-knob</loc></url>
</urlset>`

const reply = (status: number, body: string, headers: Record<string, string> = {}) =>
  ({ status, ok: status >= 200 && status < 300, headers: new Headers(headers), text: async () => body })

function stubStore({ productsJsonStatus }: { productsJsonStatus: number }) {
  const seen: string[] = []
  vi.stubGlobal('fetch', async (url: string | URL) => {
    const u = String(url)
    seen.push(u)
    if (u.includes('/products.json')) return reply(productsJsonStatus, '')        // the closed door
    if (u.includes('/wp-json/')) return reply(404, '')                            // not WooCommerce
    if (u.endsWith('/robots.txt')) return reply(200, 'User-agent: *\nAllow: /\nSitemap: https://shop.example.com/sitemap_products_1.xml')
    if (u.includes('sitemap')) return reply(200, SITEMAP)
    if (u.includes('/products/')) return reply(200, PRODUCT_PAGE)                 // a real product page
    return reply(200, html('<h1>Welcome to the shop</h1><p>' + 'x'.repeat(800) + '</p>'))
  })
  return seen
}

afterEach(() => { vi.unstubAllGlobals() })

describe('detection when a Shopify store blocks /products.json', () => {
  it('falls through to the crawl tier on 403 instead of failing', async () => {
    const seen = stubStore({ productsJsonStatus: 403 })
    const result = await detectPlatform('https://shop.example.com', { budgetMs: 20_000, limiter: fast() })

    expect(result.sourceType).toBe('jsonld_crawl')
    expect(result.reason).toBeUndefined()
    expect(result.sourceType).not.toBe('shopify_api')

    // The tier-1 probe is recorded as attempted and failed, so the trail explains the decision.
    const shopifyProbe = result.probeResults.find((p) => p.tier === 1)
    expect(shopifyProbe?.ok).toBe(false)
    expect(shopifyProbe?.status).toBe(403)

    // A 403 is the one case we retry with browser headers before giving up on the endpoint.
    expect(seen.filter((u) => u.includes('/products.json')).length).toBeGreaterThan(1)
  })

  it('does the same on 401', async () => {
    stubStore({ productsJsonStatus: 401 })
    const result = await detectPlatform('https://shop.example.com', { budgetMs: 20_000, limiter: fast() })
    expect(result.sourceType).toBe('jsonld_crawl')
  })

  it('still prefers the API when it is open, rather than crawling unnecessarily', async () => {
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const u = String(url)
      if (u.includes('/products/count.json')) return reply(200, '{"count":42}')
      if (u.includes('/products.json')) return reply(200, '{"products":[{"id":1,"title":"Brass Deadbolt"}]}')
      if (u.endsWith('/robots.txt')) return reply(200, '')
      return reply(200, html('<h1>Shop</h1>'))
    })
    const result = await detectPlatform('https://shop.example.com', { budgetMs: 20_000, limiter: fast() })
    expect(result.sourceType).toBe('shopify_api')
    expect(result.estimatedProducts).toBe(42)
  })
})
