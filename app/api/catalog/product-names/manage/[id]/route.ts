import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { deleteProductName, updateProductName } from '@/lib/catalog/product-names'

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.string().max(120).nullable().optional(),
  active: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })
  const r = await updateProductName((await params).id, parsed.data)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}

// Removes the entry from the suggestion list only — products already created keep their own name.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ok = await deleteProductName((await params).id)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
