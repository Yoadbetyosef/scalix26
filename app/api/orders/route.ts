import { NextRequest, NextResponse } from 'next/server'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { createOrderSchema } from '@/lib/orders/schema'
import { createOrder, listOrders } from '@/lib/orders/store'

export async function GET() {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ orders: await listOrders() })
}

export async function POST(req: NextRequest) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = createOrderSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  try {
    const order = await createOrder(parsed.data)
    return NextResponse.json({ ok: true, order })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Failed to create order' }, { status: 400 })
  }
}
