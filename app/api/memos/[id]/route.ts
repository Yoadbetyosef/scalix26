import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { getMemo, settleMemo, transitionMemo } from '@/lib/memos/store'
import { MEMO_STATUSES } from '@/lib/memos/types'

// GET  /api/memos/[id]           — one memo and its history.
// POST /api/memos/[id]           — move it: follow up / pending / sold / returned, with the stock effect.
// POST /api/memos/[id] {settle}  — mark a sold supplier memo settled.

const schema = z.object({
  to: z.enum(MEMO_STATUSES).optional(),
  settle: z.boolean().optional(),
  note: z.string().max(1000).nullable().optional(),
  soldPriceCents: z.number().int().min(0).nullable().optional(),
  orderId: z.string().uuid().nullable().optional(),
  toLocation: z.enum(['showroom', 'warehouse', 'storage']).nullable().optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict()

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const m = await getMemo((await params).id)
  if (!m) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(m)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const id = (await params).id
  if (parsed.data.settle) {
    const r = await settleMemo(id)
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 })
  }
  if (!parsed.data.to) return NextResponse.json({ error: 'Say where the memo is going.' }, { status: 400 })
  const r = await transitionMemo(id, { ...parsed.data, to: parsed.data.to })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, memo: r.memo })
}
