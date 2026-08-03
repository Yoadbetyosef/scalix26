import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { addProductName, addProductNamesBulk, listAllProductNames } from '@/lib/catalog/product-names'

// Managing the product-name list. Separate from the suggestions endpoint because this one also returns
// hidden entries and accepts writes; both are gated on the `inventory` module and scoped to the active
// tenant inside the store functions.

export async function GET() {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ names: await listAllProductNames() })
}

const schema = z.union([
  z.object({ name: z.string().min(1).max(200), category: z.string().max(120).nullable().optional() }),
  z.object({ bulk: z.string().min(1).max(200_000), category: z.string().max(120).nullable().optional() }),
])

export async function POST(req: NextRequest) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', detail: parsed.error.issues[0]?.message }, { status: 400 })

  if ('bulk' in parsed.data) {
    const r = await addProductNamesBulk(parsed.data.bulk, parsed.data.category ?? null)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json({ ok: true, ...r.result })
  }
  const r = await addProductName(parsed.data.name, parsed.data.category ?? null)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, item: r.item })
}
