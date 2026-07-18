import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { inventoryMove } from '@/lib/core/inventory'

// Atomic inventory movement (receive/reserve/release/allocate/ship/return/adjust). Levels + ledger move
// together in one DB transaction; guarded against over-reserving; idempotent on idempotencyKey.
const schema = z.object({
  itemKind: z.enum(['product', 'variant', 'component']), itemId: z.string().uuid(), locationId: z.string().uuid(),
  movement: z.enum(['receive', 'reserve', 'release', 'allocate', 'ship', 'return', 'adjust']),
  quantity: z.number(), refType: z.string().max(40).nullable().optional(), refId: z.string().uuid().nullable().optional(), idempotencyKey: z.string().max(200).nullable().optional(),
})
export async function POST(req: NextRequest) {
  const c = await requireCoreTenant('inventory')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await inventoryMove(c.tenantId, parsed.data, c.actor)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
