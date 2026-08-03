import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { reorderOptions } from '@/lib/orders/options'

const schema = z.object({ listId: z.string().uuid(), ids: z.array(z.string().uuid()).max(500) })

// Persist a move-up/move-down or drag reorder: `ids` in their new visual order.
export async function POST(req: NextRequest) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const ok = await reorderOptions(parsed.data.listId, parsed.data.ids)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
