import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { updateComponent, deleteComponent } from '@/lib/core/components'

const schema = z.object({ name: z.string().min(1).max(300).optional(), sku: z.string().max(200).nullable().optional(), imageUrl: z.string().max(2000).nullable().optional(), quantity: z.number().positive().optional(), priceCents: z.number().int().nullable().optional(), costCents: z.number().int().nullable().optional(), status: z.enum(['active', 'inactive', 'discontinued']).optional(), notes: z.string().max(2000).nullable().optional(), description: z.string().max(5000).nullable().optional(), componentType: z.string().max(120).nullable().optional(), trackInventory: z.boolean().optional(), category: z.string().max(120).nullable().optional(), useParentCategory: z.boolean().optional() })
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await updateComponent(c.tenantId, (await params).id, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: await deleteComponent(c.tenantId, (await params).id) })
}
