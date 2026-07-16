import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { listPOs, createPO } from '@/lib/commerce/purchase-orders'

export async function GET() {
  const c = await requireCommercePermission('purchase_orders.view')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ purchaseOrders: await listPOs() })
}

const schema = z.object({
  supplierId: z.string().uuid().nullable().optional(),
  items: z.array(z.object({
    productId: z.string().uuid().nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    sku: z.string().max(200).nullable().optional(),
    quantity: z.number().positive(),
    unitCostCents: z.number().int().nonnegative(),
    isCustom: z.boolean().optional(),
  })).min(1),
})

// Create a Purchase Order manually (not tied to a customer order) — pick a supplier + add line items.
export async function POST(req: NextRequest) {
  const c = await requireCommercePermission('purchase_orders.create')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createPO({ supplierId: parsed.data.supplierId ?? null, items: parsed.data.items })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, po: r.po })
}
