import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { listProductMaterials, setProductMaterials } from '@/lib/core/materials'

// GET → the materials/fabrics a product offers (used in the product screen + the proposal fabric selector).
// PUT → replace the product's material links.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ materials: await listProductMaterials(c.tenantId, (await params).id) })
}

const schema = z.object({ materialIds: z.array(z.string().uuid()).max(200) })
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await setProductMaterials(c.tenantId, (await params).id, parsed.data.materialIds)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
