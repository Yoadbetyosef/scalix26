// Sitemap reading, shared by the detector (does this site even have product pages?) and by the feed
// and JSON-LD adapters (which product pages, exactly?).
//
// Regex rather than an XML parser on purpose: sitemaps are a fixed, shallow shape, they arrive by the
// megabyte, and adding a parser dependency to a module that has to compile into two runtimes buys
// nothing here. Anything malformed enough to defeat these patterns is malformed enough that we should
// fall through to another tier.
import { politeFetch, type FetchOptions } from './http'

// The path shapes real stores use for a product page. Ordered by how strongly each implies "product".
export const PRODUCT_URL_PATTERNS = [
  /\/products?\//i,          // Shopify, WooCommerce, most carts
  /\/item\//i,
  /\/shop\/[^/]+\/?$/i,
  /\/p\/[^/]+\/?$/i,
]

export const looksLikeProductUrl = (url: string): boolean => PRODUCT_URL_PATTERNS.some((re) => re.test(url))

// A sitemap the site itself calls its product sitemap. This matters more than the URL shapes above:
// plenty of real stores hang products off a category path — craftmasterhardware.com lists 25,232
// products at /shop-by-category/door-locks/kw334-11p-… and exactly one of them matches any of the
// patterns above. When the site has labelled the file, believe the label and take every URL in it.
//
// "category" is excluded because sitemap_category_products.xml is a CATEGORY sitemap that happens to
// contain the word.
export const looksLikeProductSitemap = (url: string): boolean => {
  const name = url.split('/').pop()?.toLowerCase() ?? ''
  return /product/.test(name) && !/categor/.test(name)
}

export interface SitemapContents { urls: string[]; sitemaps: string[] }

export function parseSitemap(xml: string): SitemapContents {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeXml(m[1]))
  // A <sitemapindex> lists other sitemaps; a <urlset> lists pages. Tell them apart by the wrapper
  // rather than by guessing from the URLs, which are often indistinguishable.
  const isIndex = /<sitemapindex[\s>]/i.test(xml)
  return isIndex ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] }
}

const decodeXml = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

// Where a sitemap might be. robots.txt is authoritative when it says; the rest are the conventional
// locations, with Shopify's product-specific sitemap first because it is the highest-signal hit.
export const COMMON_SITEMAPS = [
  '/sitemap_products_1.xml',
  '/product-sitemap.xml',
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/wp-sitemap.xml',
]

export function sitemapsFromRobots(robotsTxt: string): string[] {
  return [...robotsTxt.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)].map((m) => m[1])
}

// Walk a sitemap (following one level of index) and return the product-looking URLs, capped. The cap
// is a hard stop, not a suggestion: an index of 40 sitemaps × 50k URLs is a real thing on the web.
export async function collectProductUrls(
  entryPoints: string[],
  cap: number,
  opts: FetchOptions & { maxSitemaps?: number } = {},
): Promise<{ urls: string[]; visited: string[]; truncated: boolean }> {
  const maxSitemaps = opts.maxSitemaps ?? 25
  const seen = new Set<string>()
  const urls: string[] = []
  const visited: string[] = []
  const queue = [...entryPoints]
  let truncated = false

  while (queue.length && visited.length < maxSitemaps) {
    const next = queue.shift()!
    if (seen.has(next)) continue
    seen.add(next)

    const res = await politeFetch(next, { ...opts, accept: 'application/xml,text/xml,*/*;q=0.8', retries: 1 })
    if (!res.ok || !res.body.includes('<')) continue
    visited.push(next)

    const { urls: pageUrls, sitemaps } = parseSitemap(res.body)
    // Prefer child sitemaps whose own name suggests products — on a big site that is the difference
    // between reading the catalogue and reading the blog.
    queue.push(...sitemaps.sort((a, b) => Number(looksLikeProductSitemap(b)) - Number(looksLikeProductSitemap(a))))

    // Inside a file the site calls its product sitemap, every entry is a product, whatever its path
    // looks like. Elsewhere we fall back to guessing from the URL.
    const trustAll = looksLikeProductSitemap(next)

    for (const u of pageUrls) {
      if (!trustAll && !looksLikeProductUrl(u)) continue
      if (seen.has(u)) continue
      seen.add(u)
      urls.push(u)
      if (urls.length >= cap) { truncated = true; return { urls, visited, truncated } }
    }
  }
  if (queue.length) truncated = true
  return { urls, visited, truncated }
}
