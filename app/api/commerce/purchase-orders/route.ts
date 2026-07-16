import { NextResponse } from 'next/server'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { listPOs } from '@/lib/commerce/purchase-orders'

export async function GET() {
  const c = await requireCommercePermission('purchase_orders.view')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ purchaseOrders: await listPOs() })
}
