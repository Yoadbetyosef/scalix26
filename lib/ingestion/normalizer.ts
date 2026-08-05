// One place where a product from any source becomes the row we store. Adapters stay close to their
// source's own words; every cleanup decision lives here, so a parsing surprise shows up in exactly
// one file and raw_payload always holds the original to check against.
import { createHash } from 'node:crypto'
import type { Availability, NormalizedProduct, RawProduct } from './types'

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

const MAX_DESCRIPTION = 2000

// Prices arrive as "$1,299.00", "1.299,00 €", "1299", 1299.0, or "" — and the difference between
// 1.299 meaning one-point-two-nine-nine and meaning one thousand two hundred ninety-nine is decided
// by which separator comes LAST.
export function parsePrice(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null
  if (typeof input === 'number') return Number.isFinite(input) ? round2(input) : null

  const cleaned = String(input).replace(/[^\d.,-]/g, '').trim()
  if (!cleaned || cleaned === '-') return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  let normalized: string
  if (lastComma === -1 && lastDot === -1) {
    normalized = cleaned
  } else if (lastComma > lastDot) {
    // Comma is the decimal separator: strip dots (thousands), swap the comma.
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else {
    // Dot is the decimal separator: strip commas (thousands).
    normalized = cleaned.replace(/,/g, '')
  }
  const n = Number(normalized)
  if (!Number.isFinite(n) || n < 0) return null
  return round2(n)
}

// Shopify's Admin API reports money in minor units as a string ("129900"); its public products.json
// reports "1299.00". Adapters call this only where they know the field is minor units.
export const minorUnitsToPrice = (input: string | number | null | undefined): number | null => {
  const n = parsePrice(input)
  return n === null ? null : round2(n / 100)
}

const round2 = (n: number) => Math.round(n * 100) / 100

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>',
  '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&rsquo;': '’', '&lsquo;': '‘',
}
const decodeEntities = (s: string): string =>
  s.replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? (
    /^&#\d+;$/.test(m) ? String.fromCodePoint(Number(m.slice(2, -1))) : m
  ))

export function stripHtml(input: string | null | undefined): string | null {
  if (!input) return null
  const text = decodeEntities(
    String(input)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ *\n */g, '\n')
    .trim()
  if (!text) return null
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…` : text
}

// Collapse whitespace, and drop a trailing SKU only when we can prove it IS the SKU — matching a
// generic "code-looking suffix" would eat real product names like "Ring 14K" or "Model 3".
export function cleanTitle(input: string | null | undefined, sku?: string | null): string {
  let t = decodeEntities(String(input ?? '')).replace(/\s+/g, ' ').trim()
  const s = (sku ?? '').trim()
  if (s && t.length > s.length) {
    const suffix = new RegExp(`[\\s\\-–—|,(\\[]*#?${escapeRegExp(s)}[\\s)\\]]*$`, 'i')
    t = t.replace(suffix, '').trim()
  }
  return t.replace(/[\s\-–—|,]+$/, '').trim()
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function absoluteUrl(input: string | null | undefined, base: string): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  try {
    const u = new URL(raw, base)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch { return null }
}

const IN_STOCK = /^(in[\s_-]?stock|instock|available|true|yes|1)$/i
const OUT_OF_STOCK = /^(out[\s_-]?of[\s_-]?stock|outofstock|sold[\s_-]?out|unavailable|false|no|0|backorder|discontinued|preorder)$/i

export function parseAvailability(input: string | number | boolean | null | undefined): Availability {
  if (input === null || input === undefined || input === '') return 'unknown'
  // schema.org gives full URLs: https://schema.org/InStock
  const v = String(input).split('/').pop()!.trim()
  if (IN_STOCK.test(v)) return 'in_stock'
  if (OUT_OF_STOCK.test(v)) return 'out_of_stock'
  return 'unknown'
}

// The identity of a product across syncs. A platform id is stable and preferred; a URL hash is the
// fallback, which is why a site that reshuffles its URLs looks like a fresh catalogue (old rows go
// inactive, new ones appear) rather than silently duplicating.
export const externalIdFor = (platformId: string | null | undefined, productUrl: string | null): string | null => {
  const id = (platformId ?? '').toString().trim()
  if (id) return id
  return productUrl ? sha256(productUrl) : null
}

// What "changed" means. Only the fields a business would notice: renamed, repriced, rewritten,
// re-photographed, or back in stock. A tracking parameter appearing on a product URL is not a change.
export const contentHashOf = (p: {
  title: string; price: number | null; description: string | null; imageUrl: string | null; availability: Availability
}): string => sha256([p.title, p.price ?? '', p.description ?? '', p.imageUrl ?? '', p.availability].join('|'))

// Takes the source's origin rather than its type: nothing in normalisation actually varies by source
// — the adapters have already reduced six wire formats to one RawProduct — and the only thing that
// genuinely differs, Shopify's minor-unit money, is handled by minorUnitsToPrice at the adapter.
export function normalize(raw: RawProduct, origin: string): NormalizedProduct | null {
  const productUrl = absoluteUrl(raw.productUrl, origin)
  const sku = (raw.sku ?? '').toString().trim() || null
  const title = cleanTitle(raw.title, sku)
  const externalId = externalIdFor(raw.externalId, productUrl)

  // A product with no name, or with nothing to identify it by, is not a product we can keep in step
  // with anything. Dropped here rather than stored as a row nobody can act on.
  if (!title || !externalId) return null

  const price = parsePrice(raw.price)
  const description = stripHtml(raw.description)
  const imageUrl = absoluteUrl(raw.imageUrl, origin)
  const availability = parseAvailability(raw.availability)

  return {
    externalId,
    title,
    description,
    price,
    comparePrice: parsePrice(raw.comparePrice),
    currency: (raw.currency ?? 'USD').toString().trim().toUpperCase().slice(0, 8) || 'USD',
    sku,
    imageUrl,
    productUrl,
    availability,
    rawPayload: raw.raw ?? null,
    contentHash: contentHashOf({ title, price, description, imageUrl, availability }),
  }
}
