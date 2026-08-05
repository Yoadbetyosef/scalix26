// Which of the six ways of reading a site applies to this one.
//
// Ordered by how much we can trust the answer, and short-circuiting on the first confident hit: a
// Shopify store's own products.json is worth more than anything we could infer from its HTML, and an
// LLM reading a page is the last resort rather than the first idea.
//
// The whole thing runs under one deadline (default 12s). The API route that calls this is a
// serverless function and a six-tier probe of a slow site will outlive it; when the budget runs out
// we return what we know so far and let the worker finish the job in the background.
import { fetchJson, joinUrl, politeFetch, normalizeSourceUrl } from './http'
import { DomainRateLimiter } from './rateLimiter'
import { fetchRobots, isAllowed, NO_ROBOTS, type RobotsRules } from './robots'
import { COMMON_SITEMAPS, collectProductUrls, looksLikeProductUrl } from './sitemap'
import { hasSubstantiveHtml, looksLikeSpaShell, productFromHtml } from './structured'
import { newTelemetry, type DetectionResult, type ProbeResult, type Telemetry } from './types'

export const DEFAULT_DETECT_BUDGET_MS = 12_000

export interface DetectOptions {
  budgetMs?: number
  telemetry?: Telemetry
  signal?: AbortSignal
  limiter?: DomainRateLimiter
}

export async function detectPlatform(input: string, opts: DetectOptions = {}): Promise<DetectionResult> {
  const url = normalizeSourceUrl(input)
  const probes: ProbeResult[] = []
  const telemetry = opts.telemetry ?? newTelemetry()

  if (!url) {
    return { sourceType: null, platform: null, confidence: 0, reason: 'unreachable', estimatedProducts: null, probeResults: probes }
  }

  const limiter = opts.limiter ?? new DomainRateLimiter()
  const budgetMs = opts.budgetMs ?? DEFAULT_DETECT_BUDGET_MS
  const deadline = Date.now() + budgetMs
  const left = () => deadline - Date.now()

  // The budget has to ABORT, not merely be consulted between steps. Checking the clock at each tier
  // boundary still lets one slow tier run long past the deadline — measured at 29s against a 20s
  // budget on a large retailer, which would outlive the serverless function this runs in. Every
  // request below carries this signal, so the deadline actually ends them.
  const clock = new AbortController()
  const timer = setTimeout(() => clock.abort(), budgetMs)
  const onOuterAbort = () => clock.abort()
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true })
  const http = { telemetry, signal: clock.signal, limiter }

  try {
    // url is passed in rather than closed over: TypeScript's narrowing from the null check above
    // does not survive into a nested function, and the parameter keeps it a plain string.
    return await run(url)
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onOuterAbort)
  }

  async function run(url: string): Promise<DetectionResult> {

  const timed = async <T>(tier: number, name: string, fn: () => Promise<{ ok: boolean; status?: number; detail?: string; value: T }>) => {
    const started = Date.now()
    try {
      const r = await fn()
      probes.push({ tier, name, ok: r.ok, status: r.status, detail: r.detail, ms: Date.now() - started })
      return r.value
    } catch (e) {
      probes.push({ tier, name, ok: false, detail: (e as Error).message, ms: Date.now() - started })
      return null
    }
  }

  // Tiers 1 and 2 are independent, cheap, and mutually exclusive — run them together rather than
  // paying for Shopify's timeout before WooCommerce gets asked. The homepage comes along too since
  // every remaining tier needs it.
  const [shopify, woo, home, robots] = await Promise.all([
    timed(1, 'shopify products.json', async () => {
      const r = await fetchJson<{ products?: unknown[] }>(joinUrl(url, 'products.json?limit=1'), { ...http, timeoutMs: Math.min(10_000, left()), retries: 0 })
      const ok = Boolean(r.ok && r.json && Array.isArray(r.json.products))
      return { ok, status: r.status, detail: ok ? `${r.json?.products?.length ?? 0} product(s) in probe` : 'no products array', value: ok }
    }),
    timed(2, 'woocommerce store api', async () => {
      const r = await politeFetch(joinUrl(url, 'wp-json/wc/store/v1/products?per_page=1'), { ...http, accept: 'application/json', timeoutMs: Math.min(10_000, left()), retries: 0 })
      let ok = false
      let total: number | null = null
      if (r.ok) {
        try { ok = Array.isArray(JSON.parse(r.body)) } catch { ok = false }
        const t = Number(r.headers.get('x-wp-total'))
        if (Number.isFinite(t) && t > 0) total = t
      }
      return { ok, status: r.status, detail: ok ? `X-WP-Total ${total ?? 'absent'}` : 'not a Store API response', value: ok ? { total } : null }
    }),
    timed(0, 'homepage', async () => {
      const r = await politeFetch(url, { ...http, timeoutMs: Math.min(10_000, left()), retries: 1 })
      return { ok: r.ok, status: r.status, detail: r.ok ? `${r.body.length} bytes` : 'no response', value: r.ok ? r.body : null }
    }),
    fetchRobots(url, { ...http, timeoutMs: 6_000 }).catch(() => null),
  ])

  if (shopify) {
    const estimated = await countShopify(url, http, left())
    return {
      sourceType: 'shopify_api', platform: 'Shopify', confidence: 0.99,
      estimatedProducts: estimated, probeResults: probes,
      pattern: { tier: 'shopify_api', apiBase: joinUrl(url, 'products.json'), discoveredAt: new Date().toISOString() },
    }
  }
  if (woo) {
    return {
      sourceType: 'woocommerce_api', platform: 'WooCommerce', confidence: 0.97,
      estimatedProducts: woo.total, probeResults: probes,
      pattern: { tier: 'woocommerce_api', apiBase: joinUrl(url, 'wp-json/wc/store/v1/products'), discoveredAt: new Date().toISOString() },
    }
  }

  // Nothing answered at all — DNS, TLS, or a site that is simply down. Distinguishable from "we read
  // it and found nothing", and a completely different message for the tenant.
  if (home === null) {
    return { sourceType: null, platform: null, confidence: 0, reason: 'unreachable', estimatedProducts: null, probeResults: probes }
  }

  // Tier 6 before 3–5: if the server sent a mount point, there is nothing for any of them to read.
  if (looksLikeSpaShell(home)) {
    probes.push({ tier: 6, name: 'spa shell', ok: true, detail: 'body is an empty mount point', ms: 0 })
    return { sourceType: null, platform: guessPlatformName(home), confidence: 0.9, reason: 'spa_unsupported', estimatedProducts: null, probeResults: probes }
  }

  // Tier 3 — a feed, either at a conventional path or linked from the homepage.
  const feedUrl = await timed(3, 'product feed', async () => {
    const linked = findLinkedFeed(home, url)
    const candidates = [...(linked ? [linked] : []), ...['/sitemap_products_1.xml', '/product-sitemap.xml', '/feed'].map((p) => joinUrl(url, p.slice(1)))]
    for (const candidate of candidates) {
      if (left() < 2_000) break
      const r = await politeFetch(candidate, { ...http, accept: 'application/xml,application/rss+xml,text/xml,*/*;q=0.8', timeoutMs: Math.min(8_000, left()), retries: 0 })
      if (r.ok && /<(urlset|sitemapindex|rss|feed)[\s>]/i.test(r.body)) {
        return { ok: true, status: r.status, detail: candidate, value: { url: candidate, isRss: /<rss[\s>]/i.test(r.body), body: r.body } }
      }
    }
    return { ok: false, detail: 'no feed at the conventional paths', value: null }
  })

  // A Google Merchant RSS feed is a product list on its own — no crawling needed.
  if (feedUrl?.isRss) {
    const items = (feedUrl.body.match(/<item[\s>]/gi) ?? []).length
    return {
      sourceType: 'product_feed', platform: 'Product feed (RSS)', confidence: 0.9,
      estimatedProducts: items || null, probeResults: probes,
      pattern: { tier: 'product_feed', feedUrl: feedUrl.url, discoveredAt: new Date().toISOString() },
    }
  }

  // Tier 4 — product URLs from a sitemap, then check whether those pages carry structured data.
  // robots.txt's own Sitemap: lines come first: that is the site telling us where its index is,
  // which beats guessing at conventional paths.
  const robotsRules: RobotsRules = robots ?? NO_ROBOTS
  const entries = [...new Set([
    ...robotsRules.sitemaps,
    ...(feedUrl ? [feedUrl.url] : []),
    ...COMMON_SITEMAPS.map((p) => joinUrl(url, p.slice(1))),
  ])]

  const sample = await timed(4, 'json-ld sample', async () => {
    if (left() < 3_000) return { ok: false, detail: 'out of detection budget', value: null }
    const { urls } = await collectProductUrls(entries, 60, { ...http, timeoutMs: Math.min(8_000, left()), maxSitemaps: 4 })
    if (!urls.length) return { ok: false, detail: 'no product URLs in any sitemap', value: null }

    // robots.txt governs the crawl tiers. If it refuses the product paths we stop here and hand the
    // tenant a fixable state — they own that file, and routing around it is not ours to do.
    const blocked = urls.filter((u) => !isAllowed(robotsRules, u))
    if (blocked.length === urls.length) {
      telemetry.robotsBlocked.push(new URL(urls[0]).pathname)
      return { ok: false, detail: 'robots.txt disallows the product paths', value: { blocked: true, urls, hits: 0, sitemapUrl: null as string | null } }
    }

    const allowed = urls.filter((u) => isAllowed(robotsRules, u))
    let hits = 0
    for (const u of allowed.slice(0, 3)) {
      if (left() < 1_500) break
      const page = await politeFetch(u, { ...http, timeoutMs: Math.min(6_000, left()), retries: 0 })
      if (page.ok && productFromHtml(page.body, u).product) hits++
    }
    return { ok: hits > 0, detail: `${hits}/3 sampled pages carried product data`, value: { blocked: false, urls: allowed, hits, sitemapUrl: entries[0] ?? null } }
  })

  if (sample?.blocked) {
    return { sourceType: null, platform: null, confidence: 0.9, reason: 'robots_blocked', estimatedProducts: null, probeResults: probes }
  }
  if (sample && sample.hits > 0) {
    return {
      sourceType: 'jsonld_crawl', platform: guessPlatformName(home) ?? 'Structured data', confidence: sample.hits >= 2 ? 0.9 : 0.7,
      estimatedProducts: sample.urls.length, probeResults: probes,
      pattern: { tier: 'jsonld_crawl', sitemapUrl: sample.sitemapUrl ?? undefined, discoveredAt: new Date().toISOString() },
    }
  }

  // Tier 5 — there is real HTML here, it just isn't marked up. This is where the LLM earns its keep.
  if (hasSubstantiveHtml(home)) {
    probes.push({ tier: 5, name: 'unstructured html', ok: true, detail: 'server-rendered, no structured product data', ms: 0 })
    return {
      sourceType: 'html_ai', platform: guessPlatformName(home) ?? 'Custom site', confidence: 0.5,
      estimatedProducts: sample?.urls.length ?? null, probeResults: probes,
      pattern: { tier: 'html_ai', sitemapUrl: sample?.sitemapUrl ?? undefined, discoveredAt: new Date().toISOString() },
    }
  }

  return { sourceType: null, platform: null, confidence: 0.4, reason: 'no_products_found', estimatedProducts: null, probeResults: probes }
  }
}

// Shopify publishes a public count on most storefronts; when it is gated we simply don't promise a
// number rather than guessing one.
async function countShopify(url: string, http: { telemetry?: Telemetry; signal?: AbortSignal; limiter?: DomainRateLimiter }, budget: number): Promise<number | null> {
  if (budget < 2_000) return null
  const r = await fetchJson<{ count?: number }>(joinUrl(url, 'products/count.json'), { ...http, timeoutMs: Math.min(5_000, budget), retries: 0 })
  const n = r.json?.count
  return typeof n === 'number' && n >= 0 ? n : null
}

// Generator/meta hints, purely for what we show the tenant. Never used to choose a tier.
function guessPlatformName(html: string): string | null {
  const generator = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)?.[1]
  if (generator) return generator.split(/[;,]/)[0].trim().slice(0, 60)
  if (/cdn\.shopify\.com/i.test(html)) return 'Shopify'
  if (/wp-content|wp-includes/i.test(html)) return 'WordPress'
  if (/squarespace/i.test(html)) return 'Squarespace'
  if (/wix\.com|wixstatic/i.test(html)) return 'Wix'
  if (/bigcommerce/i.test(html)) return 'BigCommerce'
  if (/webflow/i.test(html)) return 'Webflow'
  return null
}

// Google Merchant / RSS feeds are usually announced in the head.
function findLinkedFeed(html: string, base: string): string | null {
  for (const m of html.matchAll(/<link\s+[^>]*>/gi)) {
    const tag = m[0]
    const rel = tag.match(/rel\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? ''
    const type = tag.match(/type\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? ''
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!href) continue
    if (rel.includes('alternate') && /rss|atom|xml/.test(type)) {
      try { return new URL(href, base).toString() } catch { /* ignore */ }
    }
  }
  const merchant = html.match(/https?:\/\/[^\s"']+(?:google[^\s"']*merchant|products?\.(?:xml|rss))/i)?.[0]
  if (merchant) { try { return new URL(merchant, base).toString() } catch { /* ignore */ } }
  return null
}

export { looksLikeProductUrl }
