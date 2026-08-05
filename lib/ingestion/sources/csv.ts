// The fallback that has to work when nothing else does — an SPA, a robots.txt that says no, a shop
// that lives entirely inside a marketplace. It is a first-class source type, not a consolation prize.
//
// Headers are matched loosely (case, spacing and the usual synonyms) and anything unmatched is left
// for the caller to map by hand, exactly like the contacts importer. Only a title is required: a
// product with a name is useful to the agent; a product with a price and no name is not.
import { parseDelimited, detectDelimiter } from '../../csv/parse'
import { IngestionError, type FetchContext, type RawProduct, type SourceRef } from '../types'

export type ProductField = 'title' | 'description' | 'price' | 'compare_price' | 'currency' | 'sku' | 'image_url' | 'product_url' | 'availability' | 'external_id'

export const PRODUCT_FIELDS: Array<{ key: ProductField; label: string; required?: boolean }> = [
  { key: 'title', label: 'Product name', required: true },
  { key: 'sku', label: 'SKU' },
  { key: 'price', label: 'Price' },
  { key: 'compare_price', label: 'Compare-at price' },
  { key: 'currency', label: 'Currency' },
  { key: 'description', label: 'Description' },
  { key: 'image_url', label: 'Image URL' },
  { key: 'product_url', label: 'Product URL' },
  { key: 'availability', label: 'Availability' },
  { key: 'external_id', label: 'Product ID' },
]

const ALIASES: Record<ProductField, string[]> = {
  title: ['title', 'name', 'product', 'product name', 'item', 'item name', 'description title'],
  description: ['description', 'desc', 'details', 'body', 'body html', 'long description'],
  price: ['price', 'unit price', 'retail price', 'sale price', 'amount', 'cost'],
  compare_price: ['compare price', 'compare at price', 'was price', 'list price', 'msrp', 'regular price'],
  currency: ['currency', 'ccy', 'currency code'],
  sku: ['sku', 'item number', 'item no', 'part number', 'code', 'product code', 'mpn'],
  image_url: ['image', 'image url', 'image link', 'photo', 'picture', 'image src'],
  product_url: ['url', 'product url', 'link', 'product link', 'permalink'],
  availability: ['availability', 'stock', 'in stock', 'stock status', 'status'],
  external_id: ['id', 'product id', 'external id', 'handle'],
}

const canon = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')

// One entry per column; null means "don't import this column".
export function autoMapHeaders(headers: string[]): Array<ProductField | null> {
  const taken = new Set<ProductField>()
  return headers.map((h) => {
    const c = canon(h)
    for (const [field, aliases] of Object.entries(ALIASES) as Array<[ProductField, string[]]>) {
      if (taken.has(field)) continue
      if (aliases.includes(c)) { taken.add(field); return field }
    }
    return null
  })
}

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
  mapping: Array<ProductField | null>
}

export function parseProductCsv(text: string): ParsedCsv {
  const grid = parseDelimited(text, detectDelimiter(text))
  if (!grid.length) return { headers: [], rows: [], mapping: [] }
  const width = Math.max(...grid.map((r) => r.length))
  const headers = Array.from({ length: width }, (_, i) => grid[0][i]?.trim() || `Column ${i + 1}`)
  const mapping = autoMapHeaders(headers)
  // A file whose first row maps to nothing recognisable is a file with no header row — importing it
  // would silently eat the first product.
  const hasHeader = mapping.some((m) => m !== null)
  return {
    headers: hasHeader ? headers : Array.from({ length: width }, (_, i) => `Column ${i + 1}`),
    rows: (hasHeader ? grid.slice(1) : grid).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')),
    mapping: hasHeader ? mapping : Array.from({ length: width }, () => null),
  }
}

export function rowsToProducts(rows: string[][], mapping: Array<ProductField | null>): RawProduct[] {
  const out: RawProduct[] = []
  for (const cells of rows) {
    const rec: Partial<Record<ProductField, string>> = {}
    mapping.forEach((field, i) => {
      if (!field) return
      const v = (cells[i] ?? '').trim()
      if (v) rec[field] = v
    })
    if (!rec.title) continue
    out.push({
      externalId: rec.external_id ?? rec.sku ?? null,
      title: rec.title,
      description: rec.description ?? null,
      price: rec.price ?? null,
      comparePrice: rec.compare_price ?? null,
      currency: rec.currency ?? null,
      sku: rec.sku ?? null,
      imageUrl: rec.image_url ?? null,
      productUrl: rec.product_url ?? null,
      availability: rec.availability ?? null,
      raw: rec,
    })
  }
  return out
}

// The uploaded file is handed over on the source's extraction_pattern (the worker stages it there
// when the upload is accepted), so a CSV source re-syncs from the same file rather than needing the
// tenant to upload it again on every run.
export async function* fetchProducts(source: SourceRef, ctx: FetchContext = {}): AsyncIterable<RawProduct> {
  const csvText = (source.extractionPattern as { csvText?: string } | null | undefined)?.csvText
  if (!csvText) throw new IngestionError('no_products_found', 'No uploaded file is attached to this source.')

  const parsed = parseProductCsv(csvText)
  const stored = (source.extractionPattern as { mapping?: Array<ProductField | null> } | null | undefined)?.mapping
  const products = rowsToProducts(parsed.rows, stored ?? parsed.mapping)
  if (!products.length) throw new IngestionError('no_products_found', 'No rows in that file had a product name.')

  let seen = 0
  for (const p of products) {
    yield p
    seen++
    if (seen % 25 === 0) await ctx.onProgress?.({ current: seen, total: products.length, phase: 'reading file' })
  }
  await ctx.onProgress?.({ current: seen, total: products.length, phase: 'reading file' })
}
