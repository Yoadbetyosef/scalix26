import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { updateProposalLine, removeProposalLine } from '@/lib/core/proposals'

const schema = z.object({
  description: z.string().max(1000).nullable().optional(), quantity: z.number().min(0).optional(),
  unit_price_cents: z.number().int().min(0).optional(), discount_cents: z.number().int().min(0).optional(),
})
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id, lineId } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await updateProposalLine(c.tenantId, id, lineId, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id, lineId } = await params
  const r = await removeProposalLine(c.tenantId, id, lineId)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
