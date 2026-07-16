import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCommercePermission } from '@/lib/commerce/guard'
import { listLocations, createLocation } from '@/lib/commerce/inventory'

const schema = z.object({ name: z.string().min(1).max(200), type: z.enum(['warehouse', 'showroom', 'floor_display', 'reserved', 'damaged', 'in_transit']) })

export async function GET() {
  const c = await requireCommercePermission('inventory.view')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ locations: await listLocations() })
}

export async function POST(req: NextRequest) {
  const c = await requireCommercePermission('inventory.adjust')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createLocation(parsed.data)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, location: r.location })
}
