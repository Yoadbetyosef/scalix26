import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { requireCore } from '@/lib/core/guard'
import { getVariant } from '@/lib/core/variants'

// GET /api/core/variants/[id]/qr — a variant's public QR (name, public /p/[token] URL, rendered data URL,
// active status). Same shape as the component QR route so one panel renders both levels.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const v = await getVariant(c.tenantId, (await params).id)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const token = (v as { qr_code_token: string }).qr_code_token
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const publicUrl = `${proto}://${host}/p/${token}`
  const dataUrl = await QRCode.toDataURL(publicUrl, { width: 512, margin: 1 })
  return NextResponse.json({ name: (v as { name: string }).name, publicUrl, dataUrl, active: !!token })
}
