import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { addProposalLine } from '@/lib/core/proposals'
import { zodMessage } from '@/lib/core/zod-error'

const schema = z.object({
  productId: z.string().uuid().nullable().optional(), variantId: z.string().uuid().nullable().optional(), componentId: z.string().uuid().nullable().optional(), fabricId: z.string().uuid().nullable().optional(),
  description: z.string().max(10000).nullable().optional(), quantity: z.number().min(0), unit_price_cents: z.number().int().min(0),
  discount_cents: z.number().int().min(0).optional(),
})
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 })
  const r = await addProposalLine(c.tenantId, id, parsed.data, c.actor)
  return NextResponse.json(r, { status: r.ok ? 200 : (r.error === 'locked' ? 409 : 400) })
}
