import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { searchProductNames } from '@/lib/catalog/product-names'

// Suggestions for the Add Product form's Name field. Gated on the `inventory` module and scoped to the
// active tenant by searchProductNames, so one business never sees another's range.
export async function GET(req: NextRequest) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const q = req.nextUrl.searchParams.get('q') ?? ''
  return NextResponse.json({ names: await searchProductNames(q) })
}
