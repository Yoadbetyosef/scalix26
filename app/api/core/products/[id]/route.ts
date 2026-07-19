import { NextRequest, NextResponse } from 'next/server'
import { requireCoreTenant } from '@/lib/core/guard'
import { getProduct, updateProduct, archiveProduct, deleteProduct } from '@/lib/core/products'
import { productUpdateSchema } from '@/lib/core/product-input'

// GET one product. PATCH — update General fields, or archive/restore ({ archived }). DELETE — safe delete
// (soft tombstone if referenced by history, else hard). Commerce-gated; tenant from the guard.
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
  const id = (await params).id
  const body = await req.json().catch(() => ({}))
  if (typeof body?.archived === 'boolean') {
    const ok = await archiveProduct(c.tenantId, id, body.archived)
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 })
  }
  const parsed = productUpdateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await updateProduct(c.tenantId, id, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : (r.error === 'not_found' ? 404 : 400) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await deleteProduct(c.tenantId, (await params).id)
  return NextResponse.json(r, { status: r.ok ? 200 : (r.error === 'not_found' ? 404 : 400) })
}
