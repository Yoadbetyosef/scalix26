// Shared HTTP headers for ALL server-side website scraping/crawling. We present as a
// real desktop browser: a custom bot User-Agent (e.g. "ScalixBot/1.0") trips some
// sites' CDN/WAF bot protection and returns 403 on cache-miss, even when the page is
// plain server-rendered HTML. Keep every scrape route importing from here so the UA
// only ever needs updating in one place.
export const SCRAPER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

export const SCRAPER_ACCEPT_HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
export const SCRAPER_ACCEPT_LANGUAGE = 'en-US,en;q=0.9'

// Browser-like request headers. Pass a custom `accept` for non-HTML fetches
// (e.g. sitemap XML, products.json); the UA + Accept-Language stay constant.
export function browserScrapeHeaders(accept: string = SCRAPER_ACCEPT_HTML): Record<string, string> {
  return {
    'User-Agent': SCRAPER_USER_AGENT,
    'Accept': accept,
    'Accept-Language': SCRAPER_ACCEPT_LANGUAGE,
  }
}
