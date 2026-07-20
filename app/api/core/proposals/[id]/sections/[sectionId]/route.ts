import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { updateSection, removeSection } from '@/lib/core/proposal-sections'
import { zodMessage } from '@/lib/core/zod-error'

const schema = z.object({ title: z.string().max(200).optional(), body: z.string().max(25000).optional(), visible: z.boolean().optional() })
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; sectionId: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id, sectionId } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 })
  const r = await updateSection(c.tenantId, id, sectionId, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : (r.error === 'locked' ? 409 : 400) })
}
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; sectionId: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id, sectionId } = await params
  const r = await removeSection(c.tenantId, id, sectionId)
  return NextResponse.json(r, { status: r.ok ? 200 : (r.error === 'locked' ? 409 : 400) })
}
