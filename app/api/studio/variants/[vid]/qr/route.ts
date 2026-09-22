import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireStudioTenant } from '@/lib/studio/session'
import { publicProductUrl, qrDataUrl } from '@/lib/studio/qr'

// GET /api/studio/variants/[vid]/qr — the sub-product's own public QR (points at /p/<variant token>).
export async function GET(req: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { vid } = await params

  const db = createAdminClient()
  const { data: variant } = await db.from('studio_variants').select('qr_token').eq('id', vid).eq('tenant_id', s.tenantId).maybeSingle()
  if (!variant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const target = publicProductUrl(variant.qr_token, req.nextUrl.origin)
  return NextResponse.json({ target, dataUrl: await qrDataUrl(target) })
}
