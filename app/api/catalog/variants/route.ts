import { NextResponse } from 'next/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { getVariantsByProduct } from '@/lib/catalog/variants'

// Every sub-product for the tenant, keyed by the catalog product it belongs to — one request for the
// whole list rather than one per row. An empty object is a perfectly ordinary answer (no Studio module,
// or nothing linked yet) and the list is built to render that as today's view, with no gaps or hints.
export async function GET() {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ variants: await getVariantsByProduct() })
}
