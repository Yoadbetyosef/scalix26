import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { listSuppliers, createSupplier } from '@/lib/commerce/suppliers'

const schema = z.object({
  companyName: z.string().min(1).max(300),
  factoryName: z.string().max(300).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  paymentTerms: z.string().max(200).nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
})

export async function GET() {
  const c = await requireCommercePermission('purchase_orders.view')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ suppliers: await listSuppliers() })
}

export async function POST(req: NextRequest) {
  const c = await requireCommercePermission('purchase_orders.create')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createSupplier(parsed.data)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, supplier: r.supplier })
}
