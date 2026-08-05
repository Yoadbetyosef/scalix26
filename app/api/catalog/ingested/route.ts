import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { escapeSearchTerm } from '@/lib/contacts/store'

// Read-only view of what the website gave us. Search rather than a browsable list, because with
// 9,000 products nobody pages through — and typing a product name is exactly what the agent does
// mid-call, so this screen doubles as a way to test the answer a customer would get.
//
// Never writes. Products come in through the worker and only through the worker.

const DEFAULT_LIMIT = 12          // enough to spot a bad sync without knowing what to search for
const SEARCH_LIMIT = 24

export async function GET(req: NextRequest) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createAdminClient()
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  const safe = escapeSearchTerm(q)

  let query = db
    .from('catalog_ingested_products')
    .select('id, title, price, currency, sku, image_url, product_url, availability, last_seen_at')
    .eq('tenant_id', s.tenantId)
    .eq('is_active', true)

  if (safe) {
    query = query.or(`title.ilike.%${safe}%,sku.ilike.%${safe}%`).limit(SEARCH_LIMIT)
    // Shortest title first: on a catalogue of near-identical variants, "Round Cut Diamond Ring" is a
    // better first answer than the 90-character version of the same thing.
    query = query.order('title', { ascending: true })
  } else {
    query = query.order('last_seen_at', { ascending: false }).limit(DEFAULT_LIMIT)
  }

  // The three numbers that make a bad sync obvious: a run that captured 9,179 titles and 200 prices
  // should be visible without searching for anything.
  const scoped = () => db.from('catalog_ingested_products')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', s.tenantId).eq('is_active', true)

  const [{ data }, total, withPrice, withImage] = await Promise.all([
    query,
    scoped(),
    scoped().not('price', 'is', null),
    scoped().not('image_url', 'is', null),
  ])

  return NextResponse.json({
    products: data ?? [],
    query: q,
    stats: {
      total: total.count ?? 0,
      withPrice: withPrice.count ?? 0,
      withImage: withImage.count ?? 0,
    },
  })
}
