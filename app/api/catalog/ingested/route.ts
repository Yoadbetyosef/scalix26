import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { retrieveProducts } from '@/lib/catalog/retrieval'

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

  // A search here runs the SAME function the voice agent calls, so what the tenant sees while tuning
  // their catalogue is what a caller gets. The rows are still returned for browsing, but the grouped
  // answer is the point.
  const agent = q ? await retrieveProducts(s.tenantId, q, 'test') : null

  let query = db
    .from('catalog_ingested_products')
    .select('id, title, price, currency, sku, image_url, product_url, availability, last_seen_at')
    .eq('tenant_id', s.tenantId)
    .eq('is_active', true)

  if (q) {
    // Show exactly the rows the agent's retrieval matched — not a second, differently-worded query.
    const ids = agent?.groupIds ?? []
    query = ids.length ? query.in('id', ids).limit(SEARCH_LIMIT) : query.eq('id', '00000000-0000-0000-0000-000000000000')
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
    // What the agent would say, and the structured object behind it.
    agent: agent ? {
      say: agent.say, resolved: agent.resolved, clarifying: agent.clarifying,
      matched: agent.matched, latencyMs: agent.latencyMs, timedOut: agent.timedOut, groups: agent.groups,
    } : null,
    stats: {
      total: total.count ?? 0,
      withPrice: withPrice.count ?? 0,
      withImage: withImage.count ?? 0,
    },
  })
}
