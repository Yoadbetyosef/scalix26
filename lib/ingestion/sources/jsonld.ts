// Tier 4 — the site has no product API, but its product pages describe themselves. Collect the
// product URLs from the sitemap, then read each page's JSON-LD, falling back to Open Graph and then
// microdata (structured.ts owns that ladder).
//
// The 2,000-URL cap is a hard stop. At one request per second that is already a 33-minute crawl of
// one site; a catalogue larger than that wants a feed or an API, and the tenant is better served by
// being told so than by a job that runs all night.
import { politeFetch, type FetchOptions } from '../http'
import { isAllowed, NO_ROBOTS, type RobotsRules } from '../robots'
import { productFromHtml } from '../structured'
import { COMMON_SITEMAPS, collectProductUrls } from '../sitemap'
import { DomainRateLimiter } from '../rateLimiter'
import { IngestionError, type FetchContext, type RawProduct, type SourceRef } from '../types'
import { fetchRobots } from '../robots'

// One request per second means 2,000 URLs is already a 33-minute crawl of a single site. A catalogue
// bigger than that wants a feed or an API, and the tenant is better served by being told so.
// Overridable per deployment so a smoke test doesn't have to sit through the full cap.
export const MAX_CRAWL_URLS = Number(process.env.CATALOG_MAX_CRAWL_URLS) || 2000

// Shared by tier 4 and tier 5: find the pages worth reading, refusing to cross robots.txt.
export async function discoverProductUrls(
  source: SourceRef,
  cap: number,
  http: FetchOptions,
): Promise<{ urls: string[]; robots: RobotsRules }> {
  const robots = await fetchRobots(source.sourceUrl, { ...http, retries: 0 }).catch(() => NO_ROBOTS)
  const entries = [...new Set([
    ...robots.sitemaps,
    ...(source.extractionPattern?.sitemapUrl ? [source.extractionPattern.sitemapUrl] : []),
    ...COMMON_SITEMAPS.map((p) => new URL(p, source.sourceUrl).toString()),
  ])]

  const { urls } = await collectProductUrls(entries, cap, http)
  if (!urls.length) throw new IngestionError('no_products_found', 'No product URLs found in any sitemap.')

  const allowed = urls.filter((u) => isAllowed(robots, u))
  if (!allowed.length) {
    // They own the file; we stop and say which path was refused so the message can be specific.
    const path = new URL(urls[0]).pathname
    throw new IngestionError('robots_blocked', `robots.txt disallows ${path}`)
  }
  return { urls: allowed, robots }
}

export async function* fetchProducts(source: SourceRef, ctx: FetchContext = {}): AsyncIterable<RawProduct> {
  const limiter = new DomainRateLimiter()
  const http: FetchOptions = { telemetry: ctx.telemetry, signal: ctx.signal, limiter, retries: 1, timeoutMs: 15_000 }

  const { urls, robots } = await discoverProductUrls(source, MAX_CRAWL_URLS, http)
  // A site that asks for a slower crawl gets one — Crawl-delay is the polite version of a 429, and
  // honouring it is cheaper than being rate-limited into a failed run.
  const paced = robots.crawlDelayMs && robots.crawlDelayMs > 1000 ? new DomainRateLimiter(robots.crawlDelayMs) : limiter

  let seen = 0
  for (const url of urls) {
    if (ctx.signal?.aborted) return
    const page = await politeFetch(url, { ...http, limiter: paced })
    if (!page.ok) { seen++; continue }

    const { product } = productFromHtml(page.body, page.url)
    if (product) yield product
    seen++
    if (seen % 25 === 0) await ctx.onProgress?.({ current: seen, total: urls.length, phase: 'reading product pages' })
  }
  await ctx.onProgress?.({ current: seen, total: urls.length, phase: 'reading product pages' })
}
