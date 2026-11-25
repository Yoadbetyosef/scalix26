import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { getCostSettings } from '@/lib/catalog/costs'

// GET /api/catalog/costs — every recorded cost for the catalog list, in one read.
//
// The list shows a product's selling price, and a product that came off a supplier's price list has
// none yet — only what the supplier charges. Showing nothing there reads as "this costs nothing", so
// the list shows the cost instead, marked as a cost. Same line as the cost card: whoever may not see
// what the business pays gets an empty answer here, not a refusal the page has to handle.
export async function GET() {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const c = await requireActiveBusinessContext()
  if (!c || !c.capabilities.canViewCosts) return NextResponse.json({ products: {}, variants: {}, base: 'USD', secondary: null })

  const db = createAdminClient()
  const settings = await getCostSettings(s.tenantId)
  const products: Record<string, [number | null, number | null]> = {}
  const variants: Record<string, [number | null, number | null]> = {}
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  // In pages — the database answers at most 1,000 rows a request (see ../products/route.ts).
  for (let from = 0; from < 40000; from += 1000) {
    const { data, error } = await db.from('product_costs').select('id, product_id, variant_id, cost_primary, cost_secondary')
      .eq('tenant_id', s.tenantId).order('id').range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const r of data ?? []) {
      const pair: [number | null, number | null] = [n(r.cost_primary), n(r.cost_secondary)]
      if (r.product_id) products[r.product_id as string] = pair
      else if (r.variant_id) variants[r.variant_id as string] = pair
    }
    if (!data || data.length < 1000) break
  }
  return NextResponse.json({ products, variants, base: settings.baseCurrency, secondary: settings.secondaryCurrency })
}
