import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { addIncoming, type ItemKind } from '@/lib/core/inventory'

// Schedule an incoming shipment for an item (quantity + expected arrival + supplier/PO refs + notes).
const schema = z.object({
  itemKind: z.enum(['product', 'variant', 'component']), itemId: z.string().uuid(),
  locationId: z.string().uuid().nullable().optional(), quantity: z.number().positive(),
  expectedArrivalDate: z.string().nullable().optional(), supplierRef: z.string().max(300).nullable().optional(),
  poRef: z.string().max(300).nullable().optional(), notes: z.string().max(2000).nullable().optional(),
})
export async function POST(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const { itemKind, itemId, ...input } = parsed.data
  const r = await addIncoming(c.tenantId, itemKind as ItemKind, itemId, input, c.actor)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
