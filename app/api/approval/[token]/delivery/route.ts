import { NextRequest, NextResponse } from 'next/server'
import { enforce, clientIp } from '@/lib/ratelimit'
import { submitFactoryDelivery } from '@/lib/orders/approvals'

// PUBLIC, unauthenticated. The token in the path is the only credential (validated server-side). The factory
// uploads an invoice + marks the item ready; this moves the order production → ready. Rate-limited (fail-closed).
// The raw token is never logged. Generic error surface — no tenant/order internals leak.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const flood = await enforce('orders_approval', `ip:${clientIp(req)}`)
  if (flood) return flood
  const token = (await params).token
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  const r = await submitFactoryDelivery(token, file)
  if (!r.ok) return NextResponse.json({ error: r.error ?? 'This link is no longer available.' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
