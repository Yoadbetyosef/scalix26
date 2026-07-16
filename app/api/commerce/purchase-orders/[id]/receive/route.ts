import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { receivePO } from '@/lib/commerce/purchase-orders'

const schema = z.object({
  locationId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(200),
  lines: z.array(z.object({ poItemId: z.string().uuid(), accepted: z.number().nonnegative(), damaged: z.number().nonnegative().optional() })).min(1),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCommercePermission('purchase_orders.receive')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const { locationId, lines, idempotencyKey } = parsed.data
  const r = await receivePO((await params).id, locationId, lines, idempotencyKey)
  if (!r.ok) return NextResponse.json(r, { status: 400 })
  return NextResponse.json(r)
}
