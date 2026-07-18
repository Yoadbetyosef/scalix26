import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { updateVariant, deleteVariant } from '@/lib/core/variants'

const schema = z.object({ name: z.string().min(1).max(300).optional(), sku: z.string().max(200).nullable().optional(), priceOverrideCents: z.number().int().nullable().optional(), status: z.enum(['active', 'inactive', 'discontinued']).optional(), trackInventory: z.boolean().optional(), imageUrl: z.string().max(2000).nullable().optional() })
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('inventory')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await updateVariant(c.tenantId, (await params).id, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('inventory')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: await deleteVariant(c.tenantId, (await params).id) })
}
