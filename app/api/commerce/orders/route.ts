import { NextResponse } from 'next/server'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { listOrders } from '@/lib/commerce/orders'

export async function GET() {
  const c = await requireCommercePermission('commerce.view')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ orders: await listOrders() })
}
