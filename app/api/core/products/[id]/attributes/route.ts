import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { listDefinitions, getFieldValues, setFieldValue } from '@/lib/core/fields'

// The product's attribute schema (tenant/vertical-defined) + current values. Furniture fabric/dimensions,
// jewelry carat, etc. live here — never as Core columns.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const id = (await params).id
  const [definitions, values] = await Promise.all([listDefinitions(c.tenantId, 'product'), getFieldValues(c.tenantId, 'product', id)])
  return NextResponse.json({ definitions, values })
}

const schema = z.object({ values: z.record(z.string(), z.unknown()) })
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const id = (await params).id
  const errors: string[] = []
  for (const [key, raw] of Object.entries(parsed.data.values)) {
    const r = await setFieldValue(c.tenantId, 'product', id, key, raw)
    if (!r.ok) errors.push(r.error)
  }
  return NextResponse.json({ ok: errors.length === 0, errors }, { status: errors.length ? 400 : 200 })
}
