import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { addSection, reorderSections } from '@/lib/core/proposal-sections'
import { zodMessage } from '@/lib/core/zod-error'

// POST → add a custom section. PATCH → reorder (ids in the new order).
const addSchema = z.object({ title: z.string().max(200).optional(), body: z.string().max(25000).optional(), visible: z.boolean().optional() })
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const parsed = addSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 })
  const r = await addSection(c.tenantId, id, c.actor, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : (r.error === 'locked' ? 409 : 400) })
}

const reorderSchema = z.object({ ids: z.array(z.string().uuid()).max(50) })
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const parsed = reorderSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 })
  const r = await reorderSections(c.tenantId, id, parsed.data.ids)
  return NextResponse.json(r, { status: r.ok ? 200 : (r.error === 'locked' ? 409 : 400) })
}
