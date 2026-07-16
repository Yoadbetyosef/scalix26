import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { listProducts, createProduct } from '@/lib/commerce/catalog'

const schema = z.object({
  name: z.string().min(1).max(300),
  internalName: z.string().max(300).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  productType: z.enum(['simple_product', 'configurable_product', 'component', 'bundle', 'service', 'custom_item']).optional(),
  category: z.string().max(200).nullable().optional(),
  collection: z.string().max(200).nullable().optional(),
  brand: z.string().max(200).nullable().optional(),
  status: z.enum(['draft', 'active', 'discontinued', 'archived']).optional(),
  sku: z.string().max(100).nullable().optional(),
  cost: z.number().nonnegative().nullable().optional(),
  defaultPrice: z.number().nonnegative().nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  tags: z.array(z.string().max(60)).max(50).optional(),
})

export async function GET() {
  const c = await requireCommercePermission('catalog.view')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ products: await listProducts({ includeDrafts: true }) })
}

export async function POST(req: NextRequest) {
  const c = await requireCommercePermission('catalog.manage')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const r = await createProduct(parsed.data)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, product: r.product })
}
