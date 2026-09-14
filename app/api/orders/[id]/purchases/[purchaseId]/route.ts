import { NextRequest, NextResponse } from 'next/server'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { deletePurchase, updatePurchase } from '@/lib/orders/purchases'
import { purchaseSchema } from '../route'

// PATCH/DELETE /api/orders/[id]/purchases/[purchaseId]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; purchaseId: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = purchaseSchema.partial().safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const { id, purchaseId } = await params
  const r = await updatePurchase(id, purchaseId, parsed.data)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, purchase: r.purchase })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; purchaseId: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id, purchaseId } = await params
  const r = await deletePurchase(id, purchaseId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
