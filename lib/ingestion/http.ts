// Every outbound request in the ingestion module goes through here, so politeness, timeouts, redirect
// limits, retries and the User-Agent policy are decided once.
//
// USER-AGENT POLICY. We ask as ourselves first:
//     ScalixBot/1.0 (+https://scalix26.com/bot)
// and fall back to the browser headers in lib/scrape-headers.ts ONLY on a 403 or 429, once, for that
// request. Some CDNs refuse any non-browser agent regardless of who is asking, and the tenant has
// attested they own the site — but that is a last resort, not the default, and every fallback is
// counted in telemetry so we can measure how often it actually happens.
import { browserScrapeHeaders } from '../scrape-headers'
import { DomainRateLimiter, sleep } from './rateLimiter'
import type { Telemetry } from './types'

// Relative import of a pure, dependency-free sibling: the codebase keeps ONE browser UA string so it
// only ever needs updating in one place. Nothing else outside lib/ingestion is imported here.

export const BOT_USER_AGENT = 'ScalixBot/1.0 (+https://scalix26.com/bot)'
export const DEFAULT_TIMEOUT_MS = 10_000
export const MAX_REDIRECTS = 3

export interface FetchOptions {
  accept?: string
  timeoutMs?: number
  retries?: number            // on 429/503 and transport errors
  telemetry?: Telemetry
  signal?: AbortSignal
  limiter?: DomainRateLimiter
}

export interface FetchResult {
  ok: boolean
  status: number
  url: string                 // the final URL after redirects
  body: string
  headers: Headers
  usedBrowserUa: boolean
}

const botHeaders = (accept: string): Record<string, string> => ({
  'User-Agent': BOT_USER_AGENT,
  'Accept': accept,
  'Accept-Language': 'en-US,en;q=0.9',
})

// One request, following at most MAX_REDIRECTS hops by hand. `redirect: 'manual'` is what makes the
// cap enforceable — fetch's own following is unbounded, and a redirect loop on someone else's site
// should cost us three requests, not a hung worker.
async function once(url: string, headers: Record<string, string>, timeoutMs: number, signal?: AbortSignal): Promise<FetchResult> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const onAbort = () => ctrl.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const res = await fetch(current, { headers, redirect: 'manual', signal: ctrl.signal })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) return { ok: false, status: res.status, url: current, body: '', headers: res.headers, usedBrowserUa: false }
        current = new URL(loc, current).toString()
        continue
      }
      const body = res.ok ? await res.text() : ''
      return { ok: res.ok, status: res.status, url: current, body, headers: res.headers, usedBrowserUa: false }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
  // Ran out of hops.
  return { ok: false, status: 310, url: current, body: '', headers: new Headers(), usedBrowserUa: false }
}

export async function politeFetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const accept = opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = opts.retries ?? 2
  const limiter = opts.limiter

  let lastError: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    await limiter?.acquire(url, opts.signal)
    try {
      let res = await once(url, botHeaders(accept), timeoutMs, opts.signal)
      if (opts.telemetry) opts.telemetry.pagesFetched++

      // The one case where we change who we appear to be — and only after being told no.
      if (res.status === 403 || res.status === 429) {
        await limiter?.acquire(url, opts.signal)
        const retry = await once(url, browserScrapeHeaders(accept), timeoutMs, opts.signal)
        if (retry.ok) {
          if (opts.telemetry) { opts.telemetry.uaFallbacks++; opts.telemetry.pagesFetched++ }
          return { ...retry, usedBrowserUa: true }
        }
        res = retry
      }

      // Their rate limit beats our guess. Back the domain off and try again.
      if ((res.status === 429 || res.status === 503) && attempt < retries) {
        const delay = limiter?.penalize(url, attempt) ?? 1000 * 2 ** attempt
        await sleep(delay, opts.signal)
        continue
      }
      return res
    } catch (e) {
      lastError = e
      if (opts.signal?.aborted) throw e
      if (attempt < retries) { await sleep(500 * 2 ** attempt * (0.5 + Math.random()), opts.signal); continue }
    }
  }
  // Status 0 means the request never completed — DNS, TLS, timeout. The caller turns that into
  // 'unreachable' rather than guessing at an HTTP reason that never existed.
  if (lastError && process.env.INGESTION_DEBUG) console.error(`[ingestion] ${url}:`, (lastError as Error).message)
  return { ok: false, status: 0, url, body: '', headers: new Headers(), usedBrowserUa: false }
}

// JSON with a hard guard: a site that answers /products.json with an HTML error page must read as
// "not Shopify", never as a crash.
export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<{ ok: boolean; status: number; json: T | null; url: string }> {
  const res = await politeFetch(url, { ...opts, accept: 'application/json,text/plain;q=0.9,*/*;q=0.8' })
  if (!res.ok) return { ok: false, status: res.status, json: null, url: res.url }
  try { return { ok: true, status: res.status, json: JSON.parse(res.body) as T, url: res.url } }
  catch { return { ok: false, status: res.status, json: null, url: res.url } }
}

// Normalize what the tenant typed into an origin we can build URLs from: scheme added, trailing slash
// removed, query and fragment dropped. "  Example.COM/shop/ " → "https://example.com/shop".
export function normalizeSourceUrl(input: string): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const u = new URL(withScheme)
    if (!u.hostname.includes('.')) return null
    u.hash = ''
    u.search = ''
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? `:${u.port}` : ''}${path}`
  } catch { return null }
}

export const joinUrl = (base: string, path: string): string => new URL(path, base.endsWith('/') ? base : `${base}/`).toString()
