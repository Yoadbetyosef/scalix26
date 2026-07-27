import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { sanitizeProduct } from '@/lib/catalog/sanitize'
import { syncStudioFromCatalog, fabricFromBody } from '@/lib/studio/link'

// GET /api/catalog/products — all products for the caller's tenant (client filters/searches).
export async function GET() {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  const { data, error } = await db.from('catalog_products').select('*').eq('tenant_id', s.tenantId).order('created_at', { ascending: false }).limit(5000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ products: data || [] })
}

// POST /api/catalog/products — create a product for the caller's tenant.
export async function POST(req: NextRequest) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const db = createAdminClient()
  const { data, error } = await db.from('catalog_products').insert({ tenant_id: s.tenantId, ...sanitizeProduct(body) }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Auto-create the Studio counterpart (+ apply the chosen fabric) so the product gains the Studio
  // experience from the moment it's added. Non-fatal.
  try { await syncStudioFromCatalog(db, s.tenantId, data, fabricFromBody(body)) } catch { /* studio sync is best-effort */ }
  return NextResponse.json({ product: data })
}
