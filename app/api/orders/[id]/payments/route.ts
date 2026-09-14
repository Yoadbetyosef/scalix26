import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { ORDER_PAYMENT_METHODS, listOrderPayments, recordOrderPayment } from '@/lib/orders/payments'

// GET  /api/orders/[id]/payments — every payment recorded against the order, oldest first.
// POST /api/orders/[id]/payments — record one: a deposit, an instalment, the balance, or a refund.
//
// Card details never travel through here. `reference` is a cheque number, a transfer reference or a
// terminal receipt id — see lib/orders/payments.ts.

const schema = z.object({
  kind: z.enum(['deposit', 'payment', 'refund']),
  amountCents: z.number().int().positive().max(1_000_000_000),
  method: z.enum(ORDER_PAYMENT_METHODS).nullable().optional(),
  reference: z.string().max(120).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  idempotencyKey: z.string().max(120).nullable().optional(),
}).strict()

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ payments: await listOrderPayments((await params).id) })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const r = await recordOrderPayment((await params).id, { ...parsed.data, method: parsed.data.method ?? null })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === 'Order not found' ? 404 : 400 })
  return NextResponse.json({ ok: true, payment: r.payment, totals: r.totals, degraded: r.degraded ?? null })
}
