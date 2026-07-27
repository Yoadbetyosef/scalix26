import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { createAdminClient } from '@/lib/supabase/server'
import { requireStudioTenant } from '@/lib/studio/session'
import { ensureStudioForCatalog } from '@/lib/studio/link'

// GET /api/studio/by-catalog/[catalogId] — the Studio side of a catalog product: the linked studio
// product (created on the fly if missing) + its sub-products, documents, and public QR. Drives the
// Studio sections of the unified catalog product page.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ catalogId: string }> }) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { catalogId } = await params

  const db = createAdminClient()
  const { data: cat } = await db.from('catalog_products').select('*').eq('id', catalogId).eq('tenant_id', s.tenantId).maybeSingle()
  if (!cat) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const product = await ensureStudioForCatalog(db, s.tenantId, cat)
  if (!product) return NextResponse.json({ error: 'Could not resolve studio product' }, { status: 500 })

  const { data: variants } = await db.from('studio_variants').select('*').eq('product_id', product.id).eq('tenant_id', s.tenantId)
    .order('position', { ascending: true }).order('created_at', { ascending: true })
  const { data: documents } = await db.from('studio_documents').select('*').eq('product_id', product.id).eq('tenant_id', s.tenantId)
    .order('created_at', { ascending: false }).limit(200)

  const target = `${process.env.NEXT_PUBLIC_APP_URL || ''}/p/${product.qr_token}`
  let dataUrl: string | null = null
  try { dataUrl = await QRCode.toDataURL(target, { margin: 1, width: 240 }) } catch { /* non-fatal */ }

  return NextResponse.json({ product, variants: variants || [], documents: documents || [], qr: { target, dataUrl } })
}
