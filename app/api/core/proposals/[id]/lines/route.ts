import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { addProposalLine } from '@/lib/core/proposals'

const schema = z.object({
  productId: z.string().uuid().nullable().optional(), variantId: z.string().uuid().nullable().optional(), componentId: z.string().uuid().nullable().optional(),
  description: z.string().max(1000).nullable().optional(), quantity: z.number().min(0), unit_price_cents: z.number().int().min(0),
  discount_cents: z.number().int().min(0).optional(), customAttributes: z.record(z.string(), z.unknown()).optional(),
})
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await addProposalLine(c.tenantId, id, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
