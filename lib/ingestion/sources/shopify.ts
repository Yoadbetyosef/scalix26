// Tier 1 — a Shopify storefront's own public product API. The highest-trust source we have: it is
// the same data the store renders from, it paginates predictably, and it costs the site one cheap
// JSON response per 250 products instead of 250 page loads.
import { fetchJson, joinUrl } from '../http'
import type { FetchContext, RawProduct, SourceRef } from '../types'

const PAGE_SIZE = 250
const MAX_PAGES = 100          // 25,000 products — past this a storefront is not what we think it is

interface ShopifyVariant {
  id?: number; sku?: string | null; price?: string; compare_at_price?: string | null
  available?: boolean; title?: string
}
interface ShopifyProduct {
  id: number; title: string; handle?: string; body_html?: string | null
  published_at?: string | null; variants?: ShopifyVariant[]; images?: Array<{ src?: string }>
  image?: { src?: string } | null; vendor?: string; product_type?: string; tags?: string[]
}

export async function* fetchProducts(source: SourceRef, ctx: FetchContext = {}): AsyncIterable<RawProduct> {
  const base = source.extractionPattern?.apiBase ?? joinUrl(source.sourceUrl, 'products.json')
  let seen = 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${base}${base.includes('?') ? '&' : '?'}limit=${PAGE_SIZE}&page=${page}`
    const res = await fetchJson<{ products?: ShopifyProduct[] }>(url, {
      telemetry: ctx.telemetry, signal: ctx.signal, retries: 2, timeoutMs: 20_000,
    })
    const products = res.json?.products
    if (!res.ok || !Array.isArray(products) || products.length === 0) return

    for (const p of products) {
      // An unpublished product is not for sale and must not reach the agent as though it were.
      if (p.published_at === null) continue

      // The first variant carries the price and SKU a shopper sees on the listing; the rest travel
      // in raw_payload so a later feature can offer them without re-crawling.
      const v = p.variants?.[0]
      const image = p.image?.src ?? p.images?.[0]?.src ?? null
      const anyAvailable = (p.variants ?? []).some((x) => x.available === true)

      yield {
        externalId: String(p.id),
        title: p.title,
        description: p.body_html ?? null,
        price: v?.price ?? null,
        comparePrice: v?.compare_at_price ?? null,
        currency: null,                                   // products.json omits it; the store default applies
        sku: v?.sku ?? null,
        imageUrl: image,
        productUrl: p.handle ? joinUrl(source.sourceUrl, `products/${p.handle}`) : null,
        availability: (p.variants?.length ? anyAvailable : undefined) === undefined ? null : anyAvailable ? 'in_stock' : 'out_of_stock',
        raw: p,
      }
      seen++
    }
    await ctx.onProgress?.({ current: seen, total: null, phase: `page ${page}` })
    if (products.length < PAGE_SIZE) return
  }
}
