import { NextRequest, NextResponse } from 'next/server'
import { anthropic, MODEL } from '@/lib/anthropic/client'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { browserScrapeHeaders, SCRAPER_ACCEPT_HTML } from '@/lib/scrape-headers'

// Crawl can take a while (many fetches + 1 AI call). Allow up to 60s.
export const maxDuration = 60

// Scraped content -> knowledge_base with source='website' (distinct from 'manual'
// and 'template'); a re-scan replaces only 'website' rows, never the owner's manual KB.
const WEBSITE_SOURCE = 'website'
const MAX_PAGES = 15           // total pages crawled (incl. homepage)
const CONCURRENCY = 5          // parallel fetch batch size
const FETCH_TIMEOUT_MS = 8000
const PER_PAGE_CHARS = 6000    // cap of cleaned text kept per page
const MERGED_LIMIT = 45000     // cap of merged corpus sent to the model
const PRODUCT_PAGE_CAP = 6     // don't spend the whole crawl on product-detail pages
                               // (their prices already come from products.json) — leave
                               // room for about/faq/contact/services/collections pages

// Path/anchor keywords that signal high-value pages (prices weighted highest).
const PRICE_WORDS = ['pricing', 'prices', 'price', 'rates', 'packages', 'plans']
const VALUE_WORDS = ['services', 'service', 'products', 'product', 'collections', 'collection', 'shop', 'store', 'menu', 'about', 'faq', 'contact', 'areas', 'area']

// PDF menus/price sheets: small businesses often link the real (priced) menu as a PDF
// that the HTML crawl skips. Only fetch PDFs whose URL/anchor looks like a menu/price doc.
const PDF_WORDS = ['menu', 'price', 'pricing', 'rates', 'catering', 'services', 'service', 'packages', 'specials', 'dinner', 'lunch', 'breakfast', 'platter']
const MAX_PDFS = 3            // keep within the 60s budget
const PDF_CHARS = 6000        // cap per PDF (same as a page); counts toward MERGED_LIMIT
const PDF_TIMEOUT_MS = 12000  // hard time-box per PDF fetch+parse; slow PDFs are skipped

function normalizeUrl(raw: string): string {
  const t = raw.trim()
  return /^https?:\/\//i.test(t) ? t : 'https://' + t
}

function sameHost(a: string, b: string): boolean {
  return a.replace(/^www\./, '') === b.replace(/^www\./, '')
}

function isNoise(url: string): boolean {
  return /\/(cart|checkout|account|login|logout|signin|sign-in|register|wishlist|privacy|terms|policy|policies|legal|refund|shipping|returns|cookie|search)\b|\.(json|xml|pdf|jpe?g|png|gif|webp|svg|css|js|ico)(\?|$)|^(mailto:|tel:|javascript:)/i.test(url)
}

interface FetchResult { ok: boolean; status: number; html: string; headers: Headers }
async function fetchUrl(url: string, accept = SCRAPER_ACCEPT_HTML): Promise<FetchResult | null> {
  try {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, { signal: c.signal, headers: browserScrapeHeaders(accept) }).finally(() => clearTimeout(t))
    const html = await res.text()
    return { ok: res.ok, status: res.status, html, headers: res.headers }
  } catch { return null }
}

// Best-effort, time-boxed PDF text extraction (menus/price sheets live in linked PDFs the
// HTML crawl skips). Returns cleaned text (capped) or '' on any error/timeout/scanned-image
// PDF — never throws, never blocks the scan.
async function extractPdfText(url: string): Promise<string> {
  try {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), PDF_TIMEOUT_MS)
    const res = await fetch(url, { signal: c.signal, headers: browserScrapeHeaders('application/pdf') }).finally(() => clearTimeout(t))
    if (!res.ok) { console.log(`[scan] pdf ${url} -> HTTP ${res.status}`); return '' }
    const buf = Buffer.from(await res.arrayBuffer())
    // Lazy-load pdf-parse (pulls in ~36MB of pdfjs) ONLY when a site actually has menu
    // PDFs. Keeping it off the module top level means PDF-less scans never load it, so
    // the common case behaves exactly like before the PDF feature (pre-95ab82c).
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buf })
    try {
      const r = (await Promise.race([
        parser.getText(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('pdf parse timeout')), PDF_TIMEOUT_MS)),
      ])) as { text?: string }
      return String(r.text || '')
        .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '\n') // strip pdf-parse page markers
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, PDF_CHARS)
    } finally {
      await (parser as { destroy?: () => Promise<void> }).destroy?.()
    }
  } catch (err) {
    console.log(`[scan] pdf ${url} skipped:`, err instanceof Error ? err.message : err)
    return ''
  }
}

function extractText(html: string, limit: number): string {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || ''
  const metas: string[] = title ? [`Title: ${title}`] : []
  for (const m of html.matchAll(/<meta[^>]+>/gi)) {
    const tag = m[0]
    const name = (tag.match(/(?:name|property)=["']([^"']+)["']/i)?.[1] || '').toLowerCase()
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1]?.trim()
    if (content && (name.includes('description') || name.includes('og:') || name.includes('keywords'))) metas.push(`${name}: ${content}`)
  }
  const alts: string[] = []
  for (const m of html.matchAll(/<img[^>]+alt=["']([^"']{3,})["']/gi)) alts.push(m[1].trim())

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  body = body
    .replace(/\{[^{}]*(?:=>|querySelector|\$store|\$dispatch|function\b|document\.|window\.|addEventListener)[^{}]*\}/g, ' ')
    .replace(/\b(?:const|let|var|function|return|setTimeout|querySelector|addEventListener)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()

  const altLine = alts.length ? `Image labels: ${[...new Set(alts)].slice(0, 40).join(', ')}` : ''
  return [...metas, altLine, '', body.slice(0, limit)].filter(Boolean).join('\n')
}

function extractLinks(html: string, base: URL): { url: string; anchor: string }[] {
  const out: { url: string; anchor: string }[] = []
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const u = new URL(m[1], base)
      if (!/^https?:$/.test(u.protocol) || !sameHost(u.hostname, base.hostname)) continue
      u.hash = ''
      const anchor = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
      out.push({ url: u.toString(), anchor })
    } catch { /* ignore bad href */ }
  }
  return out
}

async function discoverSitemap(origin: string, base: URL): Promise<string[]> {
  const r = await fetchUrl(`${origin}/sitemap.xml`, 'application/xml,text/xml')
  if (!r || !r.ok) return []
  const locs = [...r.html.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim())
  // Sitemap index? follow the first few child sitemaps.
  const childMaps = locs.filter((u) => /\.xml(\?|$)/i.test(u)).slice(0, 3)
  let pageUrls = locs
  if (childMaps.length) {
    pageUrls = []
    for (const cs of childMaps) {
      const cr = await fetchUrl(cs, 'application/xml,text/xml')
      if (cr?.ok) pageUrls.push(...[...cr.html.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim()))
    }
  }
  return pageUrls.filter((u) => { try { return sameHost(new URL(u).hostname, base.hostname) } catch { return false } })
}

function score(url: string, anchor: string): number {
  const s = `${url} ${anchor}`.toLowerCase()
  let n = 0
  for (const k of PRICE_WORDS) if (s.includes(k)) n += 5
  for (const k of VALUE_WORDS) if (s.includes(k)) n += 2
  try { n -= new URL(url).pathname.split('/').filter(Boolean).length * 0.1 } catch { /* noop */ }
  return n
}

function detectShopify(html: string, headers: Headers): boolean {
  if (headers.get('x-shopid') || headers.get('x-shopify-stage') || headers.get('x-shardid')) return true
  return /cdn\.shopify\.com|myshopify\.com|Shopify\.theme|shopify-section|"shopify"/i.test(html)
}

interface ShopProduct { title: string; price: string; desc: string }
async function fetchShopifyProducts(origin: string): Promise<ShopProduct[]> {
  const r = await fetchUrl(`${origin}/products.json?limit=250`, 'application/json')
  if (!r || !r.ok) return []
  try {
    const data = JSON.parse(r.html) as { products?: Array<{ title?: string; body_html?: string; variants?: Array<{ price?: string }> }> }
    return (data.products || []).map((p) => {
      const prices = (p.variants || []).map((v) => parseFloat(String(v.price))).filter((n) => !isNaN(n))
      const min = prices.length ? Math.min(...prices) : null
      const max = prices.length ? Math.max(...prices) : null
      const price = min === null ? '' : min === max ? `$${min}` : `$${min}–$${max}`
      const desc = String(p.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)
      return { title: String(p.title || '').trim(), price, desc }
    }).filter((p) => p.title)
  } catch { return [] }
}

interface Extracted { services?: string | null; pricing?: string | null; areas?: string | null; hours?: string | null; description?: string | null }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url } = await req.json()
  if (!url || !String(url).trim()) return NextResponse.json({ added: 0, message: 'No website URL provided.' })

  const admin = createAdminClient()
  const { data: agent } = await admin.from('ai_employees').select('id, tenant_id').eq('id', agentId).single()
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  const { data: tenant } = await admin.from('tenants').select('id').eq('id', agent.tenant_id).eq('user_id', user.id).single()
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const started = Date.now()
  const target = normalizeUrl(String(url))
  let base: URL
  try { base = new URL(target) } catch { return NextResponse.json({ added: 0, error: "That doesn't look like a valid URL." }) }
  const origin = base.origin

  // 1. Homepage.
  const home = await fetchUrl(target)
  if (!home || !home.ok || home.html.length < 50) {
    console.error(`[scan] ${target} -> HTTP ${home?.status ?? 'error'} (homepage fetch failed)`)
    return NextResponse.json({ added: 0, error: "We couldn't read that website. Your details were saved — add services, pricing, and areas manually below." })
  }
  const homeNorm = (() => { const u = new URL(target); u.hash = ''; return u.toString() })()

  // Shopify shortcut: exact prices from the structured product feed.
  const shopify = detectShopify(home.html, home.headers)
  const products = shopify ? await fetchShopifyProducts(origin) : []
  if (shopify) console.log(`[scan] shopify detected → products.json returned ${products.length} products`)

  // 2 + 3. Discover candidate URLs (homepage links + sitemap), drop noise, prioritize.
  const linkMap = new Map<string, string>()
  for (const l of extractLinks(home.html, base)) if (!linkMap.has(l.url) || (l.anchor && !linkMap.get(l.url))) linkMap.set(l.url, l.anchor)
  for (const u of await discoverSitemap(origin, base)) { try { const nu = new URL(u); nu.hash = ''; if (!linkMap.has(nu.toString())) linkMap.set(nu.toString(), '') } catch { /* noop */ } }

  // PDF menus/price sheets: pick menu/price-looking PDFs from the discovered links
  // (ranked like pages), then extract their text in parallel (best-effort, time-boxed).
  const pdfUrls = [...linkMap.entries()]
    .filter(([u, anchor]) => /\.pdf(\?|$)/i.test(u) && PDF_WORDS.some((w) => `${u} ${anchor}`.toLowerCase().includes(w)))
    .sort((a, b) => score(b[0], b[1]) - score(a[0], a[1]))
    .map(([u]) => u)
    .slice(0, MAX_PDFS)
  const pdfParts: string[] = []
  if (pdfUrls.length) {
    const texts = await Promise.all(pdfUrls.map(extractPdfText))
    pdfUrls.forEach((u, i) => {
      if (texts[i]) { pdfParts.push(`PDF MENU/PRICING (${u}):\n${texts[i]}`); console.log(`[scan] pdf ${u} → extracted ${texts[i].length} chars`) }
    })
  }

  const ranked = [...linkMap.entries()]
    .filter(([u]) => !isNoise(u) && u !== homeNorm)
    .map(([u, a]) => ({ url: u, s: score(u, a) }))
    .sort((x, y) => y.s - x.s)
  // Take the top pages, but cap product-DETAIL pages so the crawl keeps breadth.
  const toCrawl: string[] = []
  let productPages = 0
  for (const c of ranked) {
    if (toCrawl.length >= MAX_PAGES - 1) break
    const isProductDetail = /\/products\//i.test(c.url)
    if (isProductDetail && productPages >= PRODUCT_PAGE_CAP) continue
    if (isProductDetail) productPages++
    toCrawl.push(c.url)
  }

  // 4. Fetch in parallel batches.
  const fetched: { url: string; html: string }[] = []
  for (let i = 0; i < toCrawl.length; i += CONCURRENCY) {
    const batch = toCrawl.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(async (u) => { const r = await fetchUrl(u); return r?.ok ? { url: u, html: r.html } : null }))
    for (const r of results) if (r) fetched.push(r)
  }
  const pages = [{ url: homeNorm, html: home.html }, ...fetched]

  // Per-page cleaned-text extraction, merged + deduped into one corpus.
  const seen = new Set<string>()
  const corpusParts: string[] = []
  for (const p of pages) {
    const text = extractText(p.html, PER_PAGE_CHARS)
    console.log(`[scan] ${p.url} → extracted ${text.length} chars`)
    const key = text.slice(0, 200)
    if (seen.has(key)) continue
    seen.add(key)
    corpusParts.push(`PAGE: ${p.url}\n${text}`)
  }
  // PDF menu/price text first (high-value), then page text — all within MERGED_LIMIT.
  let corpus = [...pdfParts, ...corpusParts].join('\n\n---\n\n').slice(0, MERGED_LIMIT)
  if (products.length) {
    corpus = `STRUCTURED PRODUCTS (exact prices):\n${products.slice(0, 80).map((p) => `${p.title} — ${p.price || 'n/a'}`).join('\n')}\n\n---\n\n${corpus}`.slice(0, MERGED_LIMIT)
  }

  // Single AI extraction over the merged corpus (any industry).
  let data: Extracted = {}
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `The content below is from MULTIPLE pages of ONE business's website (any industry — services, retail, e-commerce). Merge it into a single profile to train an AI customer assistant.

Return ONLY valid JSON. Use null only when genuinely absent. NEVER invent or guess — especially pricing.
{
  "services": "comma-separated list of the main services OR products/offerings, or null",
  "pricing": "general pricing/promotions explicitly stated (e.g. '50% off sitewide', 'Free estimates'), or null",
  "areas": "cities/regions served if a local business, or null",
  "hours": "business hours if stated, or null",
  "description": "1-2 sentence description of what the business does and who it serves, or null"
}

Website content:
${corpus}`,
      }],
    })
    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) data = JSON.parse(jsonMatch[0]) as Extracted
  } catch (err) {
    console.error('[scan] AI extraction failed:', err instanceof Error ? err.message : err)
  }

  // Build KB items. Prices captured explicitly (exact, from products.json when present).
  const items: { title: string; content: string }[] = []
  const add = (title: string, content: string) => { const c = content.trim(); if (c && c.toLowerCase() !== 'null') items.push({ title, content: c }) }

  add('Services', String(data.services ?? ''))

  const pricingParts: string[] = []
  if (data.pricing && String(data.pricing).toLowerCase() !== 'null') pricingParts.push(String(data.pricing))
  if (products.length) {
    const priced = products.filter((p) => p.price)
    const lines = priced.slice(0, 80).map((p) => `${p.title} — ${p.price}`)
    if (lines.length) pricingParts.push(lines.join('\n') + (priced.length > 80 ? `\n…and ${priced.length - 80} more` : ''))
  }
  add('Pricing', pricingParts.join('\n\n'))

  add('Service Areas', String(data.areas ?? ''))
  add('Business Hours', String(data.hours ?? ''))
  add('About', String(data.description ?? ''))
  if (products.length && !data.services) add('Products', products.slice(0, 60).map((p) => p.title).join(', '))

  const elapsed = Date.now() - started
  if (items.length === 0) {
    console.log(`[scan] crawled ${pages.length} pages | shopify=${shopify} | products=${products.length} | KB items added=0 | ${elapsed}ms`)
    return NextResponse.json({ added: 0, pages: pages.length, shopify, products: products.length, message: 'We crawled your site but found no usable details to add. You can fill them in manually below.' })
  }

  // Idempotent re-scan: replace website-sourced rows only; manual/template KB untouched.
  await admin.from('knowledge_base').delete().eq('ai_employee_id', agentId).eq('source', WEBSITE_SOURCE)
  const { error } = await admin.from('knowledge_base').insert(
    items.map((it) => ({ tenant_id: agent.tenant_id, ai_employee_id: agentId, title: it.title, content: it.content, source: WEBSITE_SOURCE })),
  )
  if (error) {
    console.error('[scan] KB insert failed:', error.message)
    return NextResponse.json({ added: 0, error: 'Could not save the website content. Please try again.' })
  }

  // Persist scan state on the agent (drives the "Connected" badge). Store the exact
  // URL the owner entered so the UI can match/stale against the field value. Resilient:
  // a failure here (e.g. columns not migrated yet) must not fail the scan response.
  const { error: stateErr } = await admin.from('ai_employees').update({
    website_scanned_at: new Date().toISOString(),
    website_scanned_url: String(url).trim(),
    website_kb_item_count: items.length,
  }).eq('id', agentId)
  if (stateErr) console.error('[scan] could not persist scan state (run add_website_scan_state.sql?):', stateErr.message)

  console.log(`[scan] crawled ${pages.length} pages | shopify=${shopify} | products=${products.length} | KB items added=${items.length} | ${elapsed}ms`)
  if (elapsed > 50000) console.warn(`[scan] elapsed ${elapsed}ms is near maxDuration=60s — consider moving to a background job`)

  return NextResponse.json({ added: items.length, titles: items.map((i) => i.title), pages: pages.length, shopify, products: products.length })
}
