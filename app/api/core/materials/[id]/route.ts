import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { getMaterial, updateMaterial, deleteMaterial } from '@/lib/core/materials'
import { zodMessage } from '@/lib/core/zod-error'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const m = await getMaterial(c.tenantId, (await params).id)
  return m ? NextResponse.json({ material: m }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}

const schema = z.object({
  name: z.string().min(1).max(200).optional(), code: z.string().max(100).nullable().optional(), image_url: z.string().url().max(2000).nullable().optional(),
  color: z.string().max(100).nullable().optional(), composition: z.string().max(500).nullable().optional(), martindale: z.string().max(100).nullable().optional(),
  width: z.string().max(100).nullable().optional(), weight: z.string().max(100).nullable().optional(), notes: z.string().max(4000).nullable().optional(),
  status: z.enum(['in_stock', 'low_stock', 'out_of_stock', 'discontinued']).optional(),
})
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 })
  const r = await updateMaterial(c.tenantId, (await params).id, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await deleteMaterial(c.tenantId, (await params).id)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
