// Reading a product out of one HTML page, without an LLM and without a DOM.
//
// Three passes in descending order of trust: JSON-LD (the site TOLD us what this is), Open Graph
// (the site told Facebook), microdata (the site told Google in 2011). The first that yields a title
// wins. Used by the JSON-LD adapter for every page, and by the detector to decide whether that tier
// will work at all.
import type { RawProduct } from './types'

// ── JSON-LD ─────────────────────────────────────────────────────────────────────────────────────────

export function extractJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = []
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const text = m[1].trim()
    if (!text) continue
    try { out.push(JSON.parse(text)) } catch {
      // Trailing commas and unescaped newlines are common in hand-rolled JSON-LD. One cheap repair
      // pass, then give up — a broken block is not worth a parser.
      try { out.push(JSON.parse(text.replace(/,\s*([}\]])/g, '$1'))) } catch { /* skip */ }
    }
  }
  return out
}

const typeOf = (node: Record<string, unknown>): string[] => {
  const t = node['@type']
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string')
}

// JSON-LD nests: @graph arrays, arrays of nodes, Product inside an ItemList. Walk it all.
export function findProductNodes(blocks: unknown[]): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = []
  const walk = (node: unknown, depth: number) => {
    if (!node || depth > 6) return
    if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return }
    if (typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    if (typeOf(obj).some((t) => t === 'Product' || t === 'ProductGroup')) found.push(obj)
    for (const key of ['@graph', 'itemListElement', 'mainEntity', 'item', 'hasVariant']) {
      if (obj[key]) walk(obj[key], depth + 1)
    }
  }
  blocks.forEach((b) => walk(b, 0))
  return found
}

const firstString = (v: unknown): string | null => {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) { for (const x of v) { const s = firstString(x); if (s) return s } return null }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return firstString(o.url ?? o['@id'] ?? o.name ?? o.contentUrl ?? null)
  }
  return null
}

// An offer may be a single object, an array, or an AggregateOffer wrapping more offers. Take the
// first concrete price; the variants stay in raw_payload for anyone who needs them later.
function readOffer(offers: unknown): { price: string | null; currency: string | null; availability: string | null } {
  const stack = [offers]
  for (let i = 0; i < stack.length && i < 20; i++) {
    const node = stack[i]
    if (Array.isArray(node)) { stack.push(...node); continue }
    if (!node || typeof node !== 'object') continue
    const o = node as Record<string, unknown>
    if (o.offers) stack.push(o.offers)
    const price = firstString(o.price ?? o.lowPrice ?? o.highPrice)
    if (price) {
      return {
        price,
        currency: firstString(o.priceCurrency),
        availability: firstString(o.availability),
      }
    }
  }
  return { price: null, currency: null, availability: null }
}

export function productFromJsonLd(html: string, pageUrl: string): RawProduct | null {
  const nodes = findProductNodes(extractJsonLdBlocks(html))
  if (!nodes.length) return null
  const node = nodes[0]
  const offer = readOffer(node.offers)
  const title = firstString(node.name)
  if (!title) return null
  return {
    externalId: firstString(node.productID ?? node.sku ?? node['@id']),
    title,
    description: firstString(node.description),
    price: offer.price,
    currency: offer.currency,
    sku: firstString(node.sku ?? node.mpn),
    imageUrl: firstString(node.image),
    productUrl: firstString(node.url) ?? pageUrl,
    availability: offer.availability,
    raw: node,
  }
}

// ── Open Graph ──────────────────────────────────────────────────────────────────────────────────────

export function readMetaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = m[0]
    const key = tag.match(/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase()
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]
    if (key && content && !(key in out)) out[key] = content
  }
  return out
}

export function productFromOpenGraph(html: string, pageUrl: string): RawProduct | null {
  const meta = readMetaTags(html)
  const title = meta['og:title'] || meta['twitter:title']
  if (!title) return null
  const price = meta['product:price:amount'] || meta['og:price:amount'] || meta['twitter:data1']
  return {
    externalId: meta['product:retailer_item_id'] || null,
    title,
    description: meta['og:description'] || meta['description'] || null,
    price: price ?? null,
    currency: meta['product:price:currency'] || meta['og:price:currency'] || null,
    sku: meta['product:retailer_item_id'] || null,
    imageUrl: meta['og:image'] || meta['twitter:image'] || null,
    productUrl: meta['og:url'] || pageUrl,
    availability: meta['product:availability'] || meta['og:availability'] || null,
    raw: { openGraph: meta },
  }
}

// ── Microdata ───────────────────────────────────────────────────────────────────────────────────────

export function productFromMicrodata(html: string, pageUrl: string): RawProduct | null {
  if (!/itemtype\s*=\s*["'][^"']*schema\.org\/Product/i.test(html)) return null
  const prop = (name: string): string | null => {
    const re = new RegExp(`<[^>]+itemprop\\s*=\\s*["']${name}["'][^>]*>`, 'i')
    const tag = html.match(re)?.[0]
    if (!tag) return null
    const attr = tag.match(/(?:content|href|src)\s*=\s*["']([^"']*)["']/i)?.[1]
    if (attr) return attr
    // Text-content form: <span itemprop="name">Ring</span>
    const textRe = new RegExp(`<([a-z0-9]+)[^>]+itemprop\\s*=\\s*["']${name}["'][^>]*>([\\s\\S]{0,400}?)<\\/\\1>`, 'i')
    const text = html.match(textRe)?.[2]
    return text ? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null : null
  }
  const title = prop('name')
  if (!title) return null
  return {
    externalId: prop('productID') ?? prop('sku'),
    title,
    description: prop('description'),
    price: prop('price'),
    currency: prop('priceCurrency'),
    sku: prop('sku'),
    imageUrl: prop('image'),
    productUrl: prop('url') ?? pageUrl,
    availability: prop('availability'),
    raw: { microdata: true },
  }
}

// The full ladder, in trust order.
export function productFromHtml(html: string, pageUrl: string): { product: RawProduct | null; via: 'jsonld' | 'opengraph' | 'microdata' | null } {
  const ld = productFromJsonLd(html, pageUrl)
  if (ld) return { product: ld, via: 'jsonld' }
  const og = productFromOpenGraph(html, pageUrl)
  if (og) return { product: og, via: 'opengraph' }
  const md = productFromMicrodata(html, pageUrl)
  if (md) return { product: md, via: 'microdata' }
  return { product: null, via: null }
}

// ── Page shape ──────────────────────────────────────────────────────────────────────────────────────

// An SPA shell: the server sent a mount point and nothing else. Detected by stripping scripts, styles
// and tags and seeing how much text is actually left — the framework-specific root ids are a hint,
// but the text length is the evidence, because plenty of SPAs use neither.
export function looksLikeSpaShell(html: string): boolean {
  const body = html.match(/<body[\s\S]*?>([\s\S]*)<\/body>/i)?.[1] ?? html
  const text = body
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const hasKnownMount = /<div[^>]+id=["'](root|__next|app|__nuxt|q-app)["'][^>]*>\s*<\/div>/i.test(html)
  return text.length < 200 || (hasKnownMount && text.length < 600)
}

// Enough server-rendered text to be worth showing an LLM.
export const hasSubstantiveHtml = (html: string): boolean => !looksLikeSpaShell(html) && html.length > 500
