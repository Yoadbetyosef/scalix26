import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { updateDraftItem, removeDraftItem } from '@/lib/commerce/drafts'

const schema = z.object({
  quantity: z.number().nonnegative().optional(),
  unitPriceCents: z.number().int().nonnegative().optional(),
  discountCents: z.number().int().nonnegative().optional(),
  customerNotes: z.string().max(2000).nullable().optional(),
  spaceId: z.string().uuid().nullable().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const c = await requireCommercePermission('commerce.edit')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id, itemId } = await params
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await updateDraftItem(id, itemId, parsed.data)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const c = await requireCommercePermission('commerce.edit')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id, itemId } = await params
  const r = await removeDraftItem(id, itemId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
