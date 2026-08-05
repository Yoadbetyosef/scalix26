// Tier 3 — a feed the site already publishes. Two shapes arrive here:
//
//   • Google Merchant / RSS — every product, fully described, in one document. The cheapest possible
//     sync: one request for the whole catalogue.
//   • An XML product sitemap — a list of URLs and nothing else, so the per-page reading is delegated
//     to the JSON-LD adapter rather than duplicated here.
import { politeFetch, type FetchOptions } from '../http'
import { DomainRateLimiter } from '../rateLimiter'
import type { FetchContext, RawProduct, SourceRef } from '../types'
import { IngestionError } from '../types'
import { fetchProducts as crawlProducts } from './jsonld'

// Google's namespace prefixes vary (g:, gm:, none), so match on the local name.
const tag = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<(?:[a-z0-9]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[a-z0-9]+:)?${name}>`, 'i'))
  if (!m) return null
  return decodeXml(m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1')).trim() || null
}

const decodeXml = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")

export function* parseRssItems(xml: string): Generator<RawProduct> {
  for (const m of xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)) {
    const item = m[0]
    const title = tag(item, 'title')
    if (!title) continue
    // Merchant feeds carry price as "12.99 USD"; the normalizer strips the currency, and we keep the
    // code separately when the feed gives one.
    const priceRaw = tag(item, 'price') ?? tag(item, 'sale_price')
    const currency = priceRaw?.match(/[A-Z]{3}/)?.[0] ?? null
    yield {
      externalId: tag(item, 'id') ?? tag(item, 'guid'),
      title,
      description: tag(item, 'description') ?? tag(item, 'summary'),
      price: priceRaw,
      comparePrice: tag(item, 'sale_price') ? tag(item, 'price') : null,
      currency,
      sku: tag(item, 'mpn') ?? tag(item, 'sku') ?? null,
      imageUrl: tag(item, 'image_link') ?? tag(item, 'image') ?? null,
      productUrl: tag(item, 'link') ?? tag(item, 'guid'),
      availability: tag(item, 'availability'),
      raw: { xml: item.slice(0, 8000) },
    }
  }
}

export async function* fetchProducts(source: SourceRef, ctx: FetchContext = {}): AsyncIterable<RawProduct> {
  const feedUrl = source.extractionPattern?.feedUrl
  const http: FetchOptions = {
    telemetry: ctx.telemetry, signal: ctx.signal, limiter: new DomainRateLimiter(),
    retries: 2, timeoutMs: 30_000, accept: 'application/xml,application/rss+xml,text/xml,*/*;q=0.8',
  }

  // No feed recorded at detection means the source was classified from a sitemap — that is a URL
  // list, which is the crawler's job, not this one's.
  if (!feedUrl) { yield* crawlProducts(source, ctx); return }

  const res = await politeFetch(feedUrl, http)
  if (!res.ok) throw new IngestionError('fetch_failed', `Feed ${feedUrl} returned ${res.status || 'no response'}.`)

  if (/<rss[\s>]|<feed[\s>]/i.test(res.body)) {
    let seen = 0
    for (const product of parseRssItems(res.body)) {
      yield product
      seen++
      if (seen % 25 === 0) await ctx.onProgress?.({ current: seen, total: null, phase: 'reading feed' })
    }
    await ctx.onProgress?.({ current: seen, total: seen, phase: 'reading feed' })
    if (seen === 0) throw new IngestionError('no_products_found', 'The feed parsed but contained no items.')
    return
  }

  // An XML sitemap: hand the URL list to the crawler.
  yield* crawlProducts({ ...source, extractionPattern: { ...(source.extractionPattern ?? { tier: 'jsonld_crawl' }), sitemapUrl: feedUrl } }, ctx)
}
