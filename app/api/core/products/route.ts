import { NextRequest, NextResponse } from 'next/server'
import { requireCoreTenant } from '@/lib/core/guard'
import { listProducts, createProduct } from '@/lib/core/products'
import { productInputSchema } from '@/lib/core/product-input'

// GET /api/core/products — products for the active tenant (Core UI catalog list). POST — create a product.
// Gated by the commerce module; tenant is server-derived from the guard, never the client.
export async function GET() {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ products: await listProducts(c.tenantId) })
}

export async function POST(req: NextRequest) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = productInputSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createProduct(c.tenantId, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
