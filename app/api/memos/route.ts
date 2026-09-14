import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { createMemo, listMemos } from '@/lib/memos/store'
import { MEMO_DIRECTIONS, MEMO_KINDS } from '@/lib/memos/types'
import { MEMOS_UNAVAILABLE } from '@/lib/memos/store'
import { getSchemaCapabilities } from '@/lib/db/capabilities'

// GET  /api/memos — every memo for the tenant.
// POST /api/memos — send a piece out on memo, or record one received from a supplier.
//
// Gated on the orders module, like everything on the jeweller's side of the app.

const schema = z.object({
  kind: z.enum(MEMO_KINDS).optional(),
  direction: z.enum(MEMO_DIRECTIONS),
  catalogProductId: z.string().uuid().nullable().optional(),
  itemDescription: z.string().max(300).nullable().optional(),
  quantity: z.number().int().min(1).max(10000).optional(),
  fromLocation: z.enum(['showroom', 'warehouse', 'storage']).nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  counterpartyName: z.string().max(200).nullable().optional(),
  agreedPriceCents: z.number().int().min(0).nullable().optional(),
  costCents: z.number().int().min(0).nullable().optional(),
  currency: z.string().max(8).optional(),
  movedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  stockIt: z.boolean().optional(),
}).strict()

export async function GET() {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { memos, missing } = await listMemos()
  return NextResponse.json({ memos, missing })
}

export async function POST(req: NextRequest) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await getSchemaCapabilities()).memos) return NextResponse.json({ error: MEMOS_UNAVAILABLE }, { status: 409 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const r = await createMemo(parsed.data)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, memo: r.memo })
}
