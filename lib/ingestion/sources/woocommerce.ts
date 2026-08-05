// Tier 2 — the WooCommerce Store API, which every modern WooCommerce install exposes without
// authentication. Page count comes from the response header rather than being guessed, so we stop
// exactly when the catalogue ends.
import { politeFetch, joinUrl } from '../http'
import type { FetchContext, RawProduct, SourceRef } from '../types'

const PAGE_SIZE = 100
const MAX_PAGES = 200

interface WooPrices {
  price?: string; regular_price?: string; sale_price?: string
  currency_code?: string; currency_minor_unit?: number
}
interface WooProduct {
  id: number; name: string; permalink?: string; sku?: string
  description?: string; short_description?: string
  prices?: WooPrices; is_in_stock?: boolean; is_purchasable?: boolean
  images?: Array<{ src?: string }>; variations?: unknown[]
}

// Store API money is minor units as a string, with the exponent given per response
// ("1299" + minor_unit 2 → 12.99). Reading currency_minor_unit rather than assuming 2 is what keeps
// zero-decimal currencies (JPY, KRW) from being divided by a hundred.
const money = (value: string | undefined, minorUnit: number | undefined): string | null => {
  if (!value) return null
  const exp = Number.isFinite(minorUnit) ? Number(minorUnit) : 2
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return (n / 10 ** exp).toFixed(Math.min(exp, 4))
}

export async function* fetchProducts(source: SourceRef, ctx: FetchContext = {}): AsyncIterable<RawProduct> {
  const base = source.extractionPattern?.apiBase ?? joinUrl(source.sourceUrl, 'wp-json/wc/store/v1/products')
  let totalPages: number | null = null
  let seen = 0

  for (let page = 1; page <= (totalPages ?? MAX_PAGES); page++) {
    const url = `${base}${base.includes('?') ? '&' : '?'}per_page=${PAGE_SIZE}&page=${page}`
    const res = await politeFetch(url, {
      accept: 'application/json', telemetry: ctx.telemetry, signal: ctx.signal, retries: 2, timeoutMs: 20_000,
    })
    if (!res.ok) return

    let items: WooProduct[]
    try { items = JSON.parse(res.body) } catch { return }
    if (!Array.isArray(items) || items.length === 0) return

    if (totalPages === null) {
      const t = Number(res.headers.get('x-wp-totalpages'))
      totalPages = Number.isFinite(t) && t > 0 ? Math.min(t, MAX_PAGES) : null
    }

    for (const p of items) {
      const minor = p.prices?.currency_minor_unit
      yield {
        externalId: String(p.id),
        title: p.name,
        description: p.description || p.short_description || null,
        price: money(p.prices?.price, minor),
        comparePrice: money(p.prices?.regular_price, minor),
        currency: p.prices?.currency_code ?? null,
        sku: p.sku || null,
        imageUrl: p.images?.[0]?.src ?? null,
        productUrl: p.permalink ?? null,
        availability: p.is_in_stock === undefined ? null : p.is_in_stock ? 'in_stock' : 'out_of_stock',
        raw: p,
      }
      seen++
    }
    await ctx.onProgress?.({ current: seen, total: totalPages ? totalPages * PAGE_SIZE : null, phase: `page ${page}${totalPages ? ` of ${totalPages}` : ''}` })
    if (items.length < PAGE_SIZE) return
  }
}
