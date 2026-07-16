import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { reserveForDraft } from '@/lib/commerce/reservations'

const schema = z.object({
  itemKind: z.enum(['product', 'variant']),
  itemId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantity: z.number().int().positive(),
  draftExpiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

// Explicit Reserve Inventory action (§5). Goes through the no-oversell RPC. On insufficient stock returns
// the exact shortfall (requested/available/missing/incoming/expectedArrival) so the UI can show it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCommercePermission('commerce.reserve_inventory')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await reserveForDraft({ draftId: (await params).id, ...parsed.data })
  if (!r.ok) return NextResponse.json(r, { status: r.error === 'insufficient' || r.error === 'no_stock' ? 409 : 400 })
  return NextResponse.json(r)
}
