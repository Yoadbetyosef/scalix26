import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { getInstance, transition } from '@/lib/core/workflow'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const inst = await getInstance(c.tenantId, (await params).id)
  if (!inst) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(inst)
}

// PATCH = transition to a stage (validated + recorded server-side).
const schema = z.object({ toStageId: z.string().uuid(), note: z.string().max(1000).optional() })
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await transition(c.tenantId, (await params).id, parsed.data.toStageId, c.actor, parsed.data.note)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
