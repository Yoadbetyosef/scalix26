import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { addDraftItem } from '@/lib/commerce/drafts'

const schema = z.object({
  lineKind: z.enum(['product', 'variant', 'bundle', 'component', 'service', 'custom', 'note']).optional(),
  productId: z.string().uuid().nullable().optional(),
  variantId: z.string().uuid().nullable().optional(),
  bundleId: z.string().uuid().nullable().optional(),
  quantity: z.number().nonnegative().optional(),
  unitPriceCents: z.number().int().nonnegative().optional(),
  discountCents: z.number().int().nonnegative().optional(),
  customerNotes: z.string().max(2000).nullable().optional(),
  spaceId: z.string().uuid().nullable().optional(),
})

// Adding an item NEVER touches inventory (§5) — it just snapshots the product and appends the line.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCommercePermission('commerce.edit')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await addDraftItem((await params).id, parsed.data)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, itemId: r.itemId })
}
