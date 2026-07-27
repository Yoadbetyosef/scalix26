import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { createAdminClient } from '@/lib/supabase/server'
import { requireStudioTenant } from '@/lib/studio/session'

// GET /api/studio/variants/[vid]/qr — the sub-product's own public QR (points at /p/<variant token>).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ vid: string }> }) {
  const s = await requireStudioTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { vid } = await params

  const db = createAdminClient()
  const { data: variant } = await db.from('studio_variants').select('qr_token').eq('id', vid).eq('tenant_id', s.tenantId).maybeSingle()
  if (!variant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const target = `${process.env.NEXT_PUBLIC_APP_URL || ''}/p/${variant.qr_token}`
  let dataUrl: string | null = null
  try { dataUrl = await QRCode.toDataURL(target, { margin: 1, width: 240 }) } catch { /* non-fatal */ }
  return NextResponse.json({ target, dataUrl })
}
