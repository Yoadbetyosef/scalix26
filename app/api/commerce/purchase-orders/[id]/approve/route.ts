import { NextRequest, NextResponse } from 'next/server'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { approvePO } from '@/lib/commerce/purchase-orders'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCommercePermission('purchase_orders.approve')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await approvePO((await params).id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
