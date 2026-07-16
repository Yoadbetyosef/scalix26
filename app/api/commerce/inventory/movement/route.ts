import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { recordMovement } from '@/lib/commerce/inventory'

// Manual inventory change (opening balance / adjustment / damage). Always writes a ledger row (§8);
// the underlying recordMovement runs through the service role, so it works after the Phase-1c lockdown.
const schema = z.object({
  itemKind: z.enum(['product', 'variant']),
  itemId: z.string().uuid(),
  locationId: z.string().uuid(),
  movementType: z.enum(['opening_balance', 'manual_adjustment', 'damage', 'customer_return', 'supplier_return']),
  delta: z.number().int(),
  field: z.enum(['on_hand', 'incoming', 'damaged', 'allocated', 'floor_display']).optional(),
  reason: z.string().max(500).optional(),
  note: z.string().max(2000).optional(),
})

export async function POST(req: NextRequest) {
  const c = await requireCommercePermission('inventory.adjust')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const r = await recordMovement(parsed.data)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, before: r.before, after: r.after })
}
