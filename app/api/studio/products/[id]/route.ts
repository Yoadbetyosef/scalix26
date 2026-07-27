import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { createAdminClient } from '@/lib/supabase/server'
import { requireStudioTenant } from '@/lib/studio/session'
import { sanitizeProduct } from '@/lib/studio/sanitize'

const publicUrl = (token: string) => `${process.env.NEXT_PUBLIC_APP_URL || ''}/p/${token}`
async function qrDataUrl(token: string): Promise<string | null> {
  try { return await QRCode.toDataURL(publicUrl(token), { margin: 1, width: 240 }) } catch { return null }
}

// GET /api/studio/products/[id] — product + its variants + a QR data URL (product-level).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const db = createAdminClient()
  // Scope by BOTH id and tenant_id — another business's product id is never readable.
  const { data: product, error } = await db.from('studio_products').select('*').eq('id', id).eq('tenant_id', s.tenantId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: variants } = await db
    .from('studio_variants').select('*').eq('product_id', id).eq('tenant_id', s.tenantId)
    .order('position', { ascending: true }).order('created_at', { ascending: true })

  const qr = { target: publicUrl(product.qr_token), dataUrl: await qrDataUrl(product.qr_token) }
  return NextResponse.json({ product, variants: variants || [], qr })
}

// PATCH /api/studio/products/[id] — update product fields.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const db = createAdminClient()
  const { data, error } = await db
    .from('studio_products')
    .update({ ...sanitizeProduct(body), updated_at: new Date().toISOString() })
    .eq('id', id).eq('tenant_id', s.tenantId)
    .select('*').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ product: data })
}

// DELETE /api/studio/products/[id] — delete a product (variants cascade).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const db = createAdminClient()
  const { error } = await db.from('studio_products').delete().eq('id', id).eq('tenant_id', s.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
