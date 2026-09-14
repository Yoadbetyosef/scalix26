import { NextRequest, NextResponse } from 'next/server'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { deleteOrderPayment } from '@/lib/orders/payments'

// DELETE /api/orders/[id]/payments/[paymentId] — withdraw a payment entered in error. The removal
// stays on the order's timeline; only the ledger row goes.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id, paymentId } = await params
  const r = await deleteOrderPayment(id, paymentId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, totals: r.totals })
}
