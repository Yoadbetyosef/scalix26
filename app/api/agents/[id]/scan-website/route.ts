import { NextRequest, NextResponse } from 'next/server'
import { anthropic, MODEL } from '@/lib/anthropic/client'
import { createClient, createAdminClient } from '@/lib/supabase/server'

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
const UA = 'Mozilla/5.0 (compatible; ScalixBot/1.0)'

// Path/anchor keywords that signal high-value pages (prices weighted highest).
const PRICE_WORDS = ['pricing', 'prices', 'price', 'rates', 'packages', 'plans']
const VALUE_WORDS = ['services', 'service', 'products', 'product', 'collections', 'collection', 'shop', 'store', 'menu', 'about', 'faq', 'contact', 'areas', 'area']

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
async function fetchUrl(url: string, accept = 'text/html'): Promise<FetchResult | null> {
  try {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, Accept: accept } }).finally(() => clearTimeout(t))
    const html = await res.text()
    return { ok: res.ok, status: res.status, html, headers: res.headers }
  } catch { return null }
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
    console.error(`[scan] homepage fetch failed for ${target} (status ${home?.status ?? 'n/a'})`)
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
  let corpus = corpusParts.join('\n\n---\n\n').slice(0, MERGED_LIMIT)
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

  console.log(`[scan] crawled ${pages.length} pages | shopify=${shopify} | products=${products.length} | KB items added=${items.length} | ${elapsed}ms`)
  if (elapsed > 50000) console.warn(`[scan] elapsed ${elapsed}ms is near maxDuration=60s — consider moving to a background job`)

  return NextResponse.json({ added: items.length, titles: items.map((i) => i.title), pages: pages.length, shopify, products: products.length })
}
