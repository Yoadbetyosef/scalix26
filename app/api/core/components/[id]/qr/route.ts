import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { requireCoreTenant } from '@/lib/core/guard'
import { getComponent } from '@/lib/core/components'

// GET /api/core/components/[id]/qr — the component's public QR: name, public URL (/p/[token] — the existing
// component QR page), a rendered QR data URL, and whether the public page is active. Commerce-gated.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = await requireCoreTenant('commerce')
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const component = await getComponent(c.tenantId, (await params).id)
  if (!component) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const token = (component as { qr_code_token: string }).qr_code_token
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const publicUrl = `${proto}://${host}/p/${token}`
  const dataUrl = await QRCode.toDataURL(publicUrl, { width: 512, margin: 1 })
  return NextResponse.json({ name: (component as { name: string }).name, publicUrl, dataUrl, active: !!token })
}
