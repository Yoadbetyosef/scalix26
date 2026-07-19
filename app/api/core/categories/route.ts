import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCoreTenant } from '@/lib/core/guard'
import { listCategories, createCategory } from '@/lib/core/categories'

// GET /api/core/categories?archived=1 — the tenant's managed categories. POST — create one.
// Commerce-gated; tenant from the guard; categories are seeded per-tenant by the installed vertical package.
export async function GET(req: NextRequest) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const includeArchived = new URL(req.url).searchParams.get('archived') === '1'
  return NextResponse.json({ categories: await listCategories(c.tenantId, { includeArchived }) })
}

const schema = z.object({ name: z.string().min(1).max(120), groupLabel: z.string().max(120).nullable().optional() })
export async function POST(req: NextRequest) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const r = await createCategory(c.tenantId, parsed.data.name, { groupLabel: parsed.data.groupLabel })
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
