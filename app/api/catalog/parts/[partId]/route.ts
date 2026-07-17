import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { sanitizePart, appBase, withQr } from '@/lib/catalog/parts'

// PATCH /api/catalog/parts/[partId] — update a part (scoped to the caller's tenant).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ partId: string }> }) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { partId } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const db = createAdminClient()
  const { data, error } = await db.from('catalog_product_parts')
    .update({ ...sanitizePart(body), updated_at: new Date().toISOString() })
    .eq('id', partId).eq('tenant_id', s.tenantId).select('*').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ part: await withQr(data, appBase(req)) })
}

// DELETE /api/catalog/parts/[partId]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ partId: string }> }) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { partId } = await params
  const db = createAdminClient()
  const { error } = await db.from('catalog_product_parts').delete().eq('id', partId).eq('tenant_id', s.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
