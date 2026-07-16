import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { proposePOFromOrderMissing } from '@/lib/commerce/purchase-orders'

const schema = z.object({ supplierId: z.string().uuid().nullable().optional() })

// Create a Purchase Order from a customer order's MISSING (unallocated) items (§9).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCommercePermission('purchase_orders.create')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await proposePOFromOrderMissing((await params).id, parsed.data.supplierId ?? null)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, po: r.po })
}
