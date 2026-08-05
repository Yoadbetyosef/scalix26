// The one place a source_type becomes an adapter. Every adapter has the same signature, so the
// worker never learns which tier it is running — it claims a job, asks for products, and writes what
// it gets.
import type { FetchContext, RawProduct, SourceRef, SourceType } from '../types'
import { IngestionError } from '../types'
import { fetchProducts as shopify } from './shopify'
import { fetchProducts as woocommerce } from './woocommerce'
import { fetchProducts as feed } from './feed'
import { fetchProducts as jsonld } from './jsonld'
import { fetchProducts as htmlAi } from './htmlAi'
import { fetchProducts as csv } from './csv'

export type Adapter = (source: SourceRef, ctx: FetchContext) => AsyncIterable<RawProduct>

const ADAPTERS: Record<SourceType, Adapter | null> = {
  shopify_api: shopify,
  woocommerce_api: woocommerce,
  product_feed: feed,
  jsonld_crawl: jsonld,
  html_ai: htmlAi,
  csv_upload: csv,
  // A hand-added product has no upstream to read; nothing syncs it, by design.
  manual: null,
}

export function adapterFor(type: SourceType): Adapter {
  const adapter = ADAPTERS[type]
  if (!adapter) throw new IngestionError('no_products_found', `Source type "${type}" has nothing to sync.`)
  return adapter
}

export { shopify, woocommerce, feed, jsonld, htmlAi, csv }
