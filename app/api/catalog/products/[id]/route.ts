import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { sanitizeProduct } from '@/lib/catalog/sanitize'

// GET /api/catalog/products/[id] — product + movement history + a QR data URL.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const db = createAdminClient()
  // Scope by BOTH id and tenant_id — another business's product id is never readable.
  const { data: product, error } = await db.from('catalog_products').select('*').eq('id', id).eq('tenant_id', s.tenantId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: movements } = await db.from('catalog_movements').select('*').eq('product_id', id).eq('tenant_id', s.tenantId).order('created_at', { ascending: false }).limit(100)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const qrTarget = `${appUrl}/catalog/${id}`
  let qrDataUrl: string | null = null
  try { qrDataUrl = await QRCode.toDataURL(qrTarget, { margin: 1, width: 240 }) } catch { /* non-fatal */ }

  return NextResponse.json({ product, movements: movements || [], qr: { target: qrTarget, dataUrl: qrDataUrl } })
}

// PATCH /api/catalog/products/[id] — update product fields.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const db = createAdminClient()
  const { data, error } = await db
    .from('catalog_products')
    .update({ ...sanitizeProduct(body), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', s.tenantId)
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ product: data })
}
