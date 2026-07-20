import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCore } from '@/lib/core/guard'
import { listLocations, createLocation } from '@/lib/core/inventory'

export async function GET() {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ locations: await listLocations(c.tenantId) })
}

const schema = z.object({ name: z.string().min(1).max(200), kind: z.string().max(40).optional() })
export async function POST(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createLocation(c.tenantId, parsed.data.name, parsed.data.kind)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
