import { NextResponse } from 'next/server'
import { requireCoreTenant } from '@/lib/core/guard'
import { listProducts } from '@/lib/core/products'

// GET /api/core/products — products for the active tenant (Core UI catalog list). Gated by the commerce
// module; tenant is server-derived from the guard, never the client.
export async function GET() {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ products: await listProducts(c.tenantId) })
}
