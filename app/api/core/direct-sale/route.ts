import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { createDirectSale } from '@/lib/core/direct-sale'

// Catalog → Create invoice / Create order, no proposal required.
const line = z.object({
  productId: z.string().uuid().nullable().optional(), componentId: z.string().uuid().nullable().optional(), variantId: z.string().uuid().nullable().optional(),
  description: z.string().max(1000).nullable().optional(), quantity: z.number().min(0), unit_price_cents: z.number().int().min(0), customAttributes: z.record(z.string(), z.unknown()).optional(),
})
const schema = z.object({ target: z.enum(['invoice', 'order']), contactId: z.string().uuid().nullable().optional(), lines: z.array(line).min(1) })
export async function POST(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createDirectSale(c.tenantId, c.actor, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
