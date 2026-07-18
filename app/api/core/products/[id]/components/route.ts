import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { listComponents, createComponent } from '@/lib/core/components'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ components: await listComponents(c.tenantId, (await params).id) })
}

const schema = z.object({ name: z.string().min(1).max(300), sku: z.string().max(200).nullable().optional(), imageUrl: z.string().max(2000).nullable().optional(), quantity: z.number().positive().optional(), priceCents: z.number().int().nullable().optional(), status: z.enum(['active', 'inactive', 'discontinued']).optional(), variantId: z.string().uuid().nullable().optional(), notes: z.string().max(2000).nullable().optional() })
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createComponent(c.tenantId, (await params).id, parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
