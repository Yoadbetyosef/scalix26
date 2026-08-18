import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { billToExpense } from '@/lib/money-out/reclassify'

// A bill that was never stock, moved to Money out.
//
// One direction only, deliberately. Bill → expense is free because everything an expense needs was
// already extracted; expense → bill needs the document read a second time, because the expense path
// never extracted the lines. When that direction is built it belongs on its own endpoint with its own
// cost, not as a flag on this one.
//
// .strict(), like every other write in this feature: an unexpected key is a 400 rather than a silent
// drop.
const schema = z.object({
  shipmentId: z.string().uuid(),
  // The one field the document cannot supply. See the store function for why it is never guessed.
  category: z.string().min(1).max(64),
}).strict()

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const r = await billToExpense(parsed.data.shipmentId, parsed.data.category)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ expenseId: r.expenseId })
}
