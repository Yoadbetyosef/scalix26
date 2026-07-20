import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { listMaterials, createMaterial } from '@/lib/core/materials'
import { zodMessage } from '@/lib/core/zod-error'

// GET → the tenant's material/fabric library (search + status filter). POST → create one.
export async function GET(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ materials: await listMaterials(c.tenantId, { search: req.nextUrl.searchParams.get('search') || undefined, status: req.nextUrl.searchParams.get('status') || undefined }) })
}

const schema = z.object({
  name: z.string().min(1).max(200), code: z.string().max(100).nullable().optional(), image_url: z.string().url().max(2000).nullable().optional(),
  color: z.string().max(100).nullable().optional(), composition: z.string().max(500).nullable().optional(), martindale: z.string().max(100).nullable().optional(),
  width: z.string().max(100).nullable().optional(), weight: z.string().max(100).nullable().optional(), notes: z.string().max(4000).nullable().optional(),
  status: z.enum(['in_stock', 'low_stock', 'out_of_stock', 'discontinued']).optional(),
})
export async function POST(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 })
  const r = await createMaterial(c.tenantId, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
