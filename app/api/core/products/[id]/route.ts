import { NextRequest, NextResponse } from 'next/server'
import { requireCoreTenant } from '@/lib/core/guard'
import { getProduct, updateProduct } from '@/lib/core/products'
import { productUpdateSchema } from '@/lib/core/product-input'

// GET /api/core/products/[id] — one product's General/header data. PATCH — update typed General fields.
// Commerce-gated; tenant from the guard; a browser can never read/patch another tenant's product.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const product = await getProduct(c.tenantId, (await params).id)
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ product })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = productUpdateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await updateProduct(c.tenantId, (await params).id, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : (r.error === 'not_found' ? 404 : 400) })
}
