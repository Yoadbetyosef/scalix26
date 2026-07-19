import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { renameCategory, setCategoryArchived, deleteCategory } from '@/lib/core/categories'

// PATCH — rename (name) and/or archive/restore (archived). DELETE — remove, only when unused.
const schema = z.object({ name: z.string().min(1).max(120).optional(), archived: z.boolean().optional() })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const id = (await params).id
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  if (parsed.data.name != null) { const r = await renameCategory(c.tenantId, id, parsed.data.name); if (!r.ok) return NextResponse.json(r, { status: r.error === 'not_found' ? 404 : 400 }) }
  if (parsed.data.archived != null) { const ok = await setCategoryArchived(c.tenantId, id, parsed.data.archived); if (!ok) return NextResponse.json({ ok: false }, { status: 400 }) }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await deleteCategory(c.tenantId, (await params).id)
  return NextResponse.json(r, { status: r.ok ? 200 : (r.error === 'in_use' ? 409 : 400) })
}
