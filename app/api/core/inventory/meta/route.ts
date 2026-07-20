import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { setItemMeta, type ItemKind } from '@/lib/core/inventory'

// Set per-item availability + notes (availability_status null = auto-derive). AI notes are customer-facing.
const schema = z.object({
  itemKind: z.enum(['product', 'variant', 'component']), itemId: z.string().uuid(),
  availability_status: z.enum(['in_stock', 'low_stock', 'out_of_stock', 'incoming', 'made_to_order', 'discontinued']).nullable().optional(),
  low_stock_threshold: z.number().min(0).optional(), ai_notes: z.string().max(4000).nullable().optional(),
  internal_notes: z.string().max(4000).nullable().optional(), location_notes: z.string().max(4000).nullable().optional(),
})
export async function POST(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const { itemKind, itemId, ...patch } = parsed.data
  const r = await setItemMeta(c.tenantId, itemKind as ItemKind, itemId, patch)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
