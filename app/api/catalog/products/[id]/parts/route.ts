import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { sanitizePart, appBase, withQr } from '@/lib/catalog/parts'

// GET /api/catalog/products/[id]/parts — the product's parts, each with a QR data URL.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const db = createAdminClient()
  const { data, error } = await db.from('catalog_product_parts').select('*').eq('tenant_id', s.tenantId).eq('product_id', id).order('sort_order', { ascending: true }).order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const base = appBase(req)
  const parts = await Promise.all((data || []).map((p) => withQr(p, base)))
  return NextResponse.json({ parts })
}

// POST /api/catalog/products/[id]/parts — add a part to the product.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const fields = sanitizePart(body)
  if (!fields.name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const db = createAdminClient()
  // Confirm the product belongs to this tenant before attaching a part.
  const { data: product } = await db.from('catalog_products').select('id').eq('id', id).eq('tenant_id', s.tenantId).maybeSingle()
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  const { count } = await db.from('catalog_product_parts').select('id', { count: 'exact', head: true }).eq('tenant_id', s.tenantId).eq('product_id', id)

  const { data, error } = await db.from('catalog_product_parts').insert({ tenant_id: s.tenantId, product_id: id, sort_order: count ?? 0, ...fields }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ part: await withQr(data, appBase(req)) })
}
