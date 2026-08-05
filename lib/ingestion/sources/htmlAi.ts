// The last automated tier — pages that are real HTML but describe nothing about themselves. Haiku
// reads the stripped text and returns the fields; we then work out WHERE on the page each value came
// from, save that map, and stop paying for the model.
//
// Two hard limits, because this is the only tier that costs money per page:
//   • 100 pages per source, ever.
//   • The LLM runs on the initial sync only. Once a field map is derived and verified against the
//     page it came from, the rest of the run and every later sync replay it deterministically.
//
// The map is derived by US, not authored by the model: we take the values Haiku extracted, find them
// in the raw HTML, and record the meta tag or class-bearing element they sat in. Asking a language
// model to write selectors produces confident, subtly wrong ones; asking it "what does this page
// say" and then locating the answer ourselves does not.
import { z } from 'zod'
import { politeFetch, type FetchOptions } from '../http'
import { DomainRateLimiter } from '../rateLimiter'
import { readMetaTags } from '../structured'
import { IngestionError, type ExtractionPattern, type FetchContext, type RawProduct, type SourceRef } from '../types'
import { discoverProductUrls } from './jsonld'

export const MAX_AI_PAGES = 100
const MAX_TEXT_CHARS = 6000

const extracted = z.object({
  title: z.string().min(1).nullable().optional(),
  description: z.string().nullable().optional(),
  price: z.union([z.string(), z.number()]).nullable().optional(),
  currency: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  availability: z.string().nullable().optional(),
})
export type Extracted = z.infer<typeof extracted>

const PROMPT = (url: string, text: string) => `You are reading ONE product page from an online shop.

Return ONLY a JSON object with these keys, using null for anything the page does not state:
{"title":string|null,"description":string|null,"price":string|null,"currency":string|null,"sku":string|null,"image_url":string|null,"availability":"in_stock"|"out_of_stock"|null}

Rules:
- title is the product's own name, not the shop's name and not the page heading if that is the shop name.
- price is the number as shown, without a currency symbol. If several prices appear, take the one for this product, not a "from" or a related item.
- Do not invent a value. If the page does not say it, the value is null.
- If this page is not a product page at all, return {"title":null}.

URL: ${url}

PAGE TEXT:
${text}`

// Everything the model sees. Scripts and styles go first, then tags, and the result is capped —
// a 500KB page of markup costs tokens without adding information.
export function pageToText(html: string): string {
  const body = html.match(/<body[\s\S]*?>([\s\S]*)<\/body>/i)?.[1] ?? html
  const text = body
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, MAX_TEXT_CHARS)
}

// ── The deterministic replay ────────────────────────────────────────────────────────────────────────

// A field map entry is one of:
//   meta:<name>       — the value was the content of that meta tag
//   class:<token>     — the value was the text of an element carrying that class
// Both are checked against the page they were derived from before being saved.
export type FieldMap = Record<string, string>

const FIELDS = ['title', 'description', 'price', 'currency', 'sku', 'image_url', 'availability'] as const

export function deriveFieldMap(html: string, values: Extracted): FieldMap {
  const meta = readMetaTags(html)
  const map: FieldMap = {}
  for (const field of FIELDS) {
    const raw = values[field]
    const value = raw === null || raw === undefined ? '' : String(raw).trim()
    if (!value || value.length < 2) continue

    const metaHit = Object.entries(meta).find(([, v]) => v.trim() === value)
    if (metaHit) { map[field] = `meta:${metaHit[0]}`; continue }

    // An element whose class names the field and whose text is exactly the value — the common shape
    // for prices and titles on hand-built shops.
    const classHit = html.match(
      new RegExp(`<[a-z0-9]+[^>]*class=["']([^"']*)["'][^>]*>\\s*${escapeRegExp(value)}\\s*<`, 'i'),
    )?.[1]
    if (classHit) {
      const token = classHit.split(/\s+/).find((c) => /price|title|name|sku|stock|avail/i.test(c)) ?? classHit.split(/\s+/)[0]
      if (token) map[field] = `class:${token}`
    }
  }
  return map
}

export function applyFieldMap(html: string, map: FieldMap): Extracted {
  const meta = readMetaTags(html)
  const out: Record<string, string | null> = {}
  for (const [field, rule] of Object.entries(map)) {
    if (rule.startsWith('meta:')) {
      out[field] = meta[rule.slice(5)] ?? null
    } else if (rule.startsWith('class:')) {
      const token = rule.slice(6)
      const m = html.match(new RegExp(`<[a-z0-9]+[^>]*class=["'][^"']*\\b${escapeRegExp(token)}\\b[^"']*["'][^>]*>([\\s\\S]{0,300}?)<`, 'i'))
      out[field] = m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null : null
    }
  }
  return extracted.parse(out)
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A map is only worth saving if it reproduces what the model found — on the page it was derived from
// and, ideally, on a second page. Title and price are the two fields that make a product usable.
export function mapIsUsable(map: FieldMap, html: string, values: Extracted): boolean {
  if (!map.title) return false
  const replayed = applyFieldMap(html, map)
  const same = (a: unknown, b: unknown) => String(a ?? '').trim() === String(b ?? '').trim()
  if (!same(replayed.title, values.title)) return false
  if (values.price && !same(replayed.price, values.price)) return false
  return true
}

const toRawProduct = (v: Extracted, url: string, html: string): RawProduct | null => {
  if (!v.title) return null
  return {
    externalId: v.sku ?? null,
    title: v.title,
    description: v.description ?? null,
    price: v.price ?? null,
    currency: v.currency ?? null,
    sku: v.sku ?? null,
    imageUrl: v.image_url ?? readMetaTags(html)['og:image'] ?? null,
    productUrl: url,
    availability: v.availability ?? null,
    raw: { extracted: v, via: 'html_ai' },
  }
}

export async function* fetchProducts(source: SourceRef, ctx: FetchContext = {}): AsyncIterable<RawProduct> {
  const limiter = new DomainRateLimiter()
  const http: FetchOptions = { telemetry: ctx.telemetry, signal: ctx.signal, limiter, retries: 1, timeoutMs: 15_000 }

  const saved = source.extractionPattern?.htmlSelectors as FieldMap | undefined
  let map: FieldMap | null = saved && Object.keys(saved).length ? saved : null

  // Without a saved map this run needs the model; refusing early is better than crawling 100 pages
  // and discovering there was nothing to read them with.
  if (!map && !ctx.llm) throw new IngestionError('llm_failed', 'This source needs AI extraction, but no extractor was provided.')

  const { urls } = await discoverProductUrls(source, MAX_AI_PAGES, http)
  let seen = 0
  let llmPagesUsed = 0

  for (const url of urls.slice(0, MAX_AI_PAGES)) {
    if (ctx.signal?.aborted) return
    const page = await politeFetch(url, http)
    if (!page.ok) { seen++; continue }

    let values: Extracted | null = null

    if (map) {
      // Deterministic path — no model, no cost.
      try { values = applyFieldMap(page.body, map) } catch { values = null }
    }

    if ((!values || !values.title) && ctx.llm) {
      const text = pageToText(page.body)
      if (text.length > 200) {
        try {
          const r = await ctx.llm.extract({ prompt: PROMPT(url, text), maxTokens: 700 })
          values = extracted.parse(r.json)
          llmPagesUsed++
          if (ctx.telemetry) ctx.telemetry.llmCalls++
        } catch { values = null }
      }

      // First good extraction: work out where those values live and, if the map reproduces them,
      // save it and stop calling the model for the rest of this run.
      if (values?.title && !map) {
        const candidate = deriveFieldMap(page.body, values)
        if (mapIsUsable(candidate, page.body, values)) {
          map = candidate
          ctx.onPattern?.({
            tier: 'html_ai',
            sitemapUrl: source.extractionPattern?.sitemapUrl,
            htmlSelectors: candidate,
            discoveredAt: new Date().toISOString(),
          } satisfies ExtractionPattern)
        }
      }
    }

    const product = values ? toRawProduct(values, page.url, page.body) : null
    if (product) yield product
    seen++
    if (seen % 25 === 0) await ctx.onProgress?.({ current: seen, total: urls.length, phase: map ? 'reading pages' : 'reading pages with AI' })
  }

  await ctx.onProgress?.({ current: seen, total: urls.length, phase: 'done' })
  if (seen === 0) throw new IngestionError('no_products_found', 'No readable product pages were found.')
  if (llmPagesUsed === 0 && !map) throw new IngestionError('llm_failed', 'AI extraction produced nothing usable on any page.')
}
